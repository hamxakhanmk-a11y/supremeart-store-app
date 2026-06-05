const { sql, ensureTables, parseBody, logActivity } = require('../lib/db');
const { requireAdmin, generateToken, ROLES } = require('../lib/auth');
const { sendEmail, isEmailConfigured, inviteTemplate, resetTemplate } = require('../lib/email');

function originFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

const SETUP_TOKEN_HOURS = 72;

function generateSetupToken() {
  return generateToken();
}

async function lastAdminProtection(targetId) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND id <> ${targetId}`;
  return rows[0].c === 0; // true means target is the LAST admin
}

module.exports = async (req, res) => {
  try {
    await ensureTables();
    const user = await requireAdmin(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT u.id, u.email, u.name, u.role,
               u.password_hash IS NOT NULL AS "hasPassword",
               u.created_at::text AS "createdAt",
               u.last_login_at::text AS "lastLoginAt",
               u.invited_at::text AS "invitedAt",
               inv.name AS "invitedByName",
               inv.email AS "invitedByEmail"
        FROM users u
        LEFT JOIN users inv ON inv.id = u.invited_by_user_id
        ORDER BY u.id
      `;
      return res.json(rows);
    }

    if (req.method === 'POST' && req.query.action === 'reset') {
      // Generate a fresh 24-hour password-reset token for an existing user.
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'User id required' });
      const target = await sql`SELECT id, email, name FROM users WHERE id = ${id} LIMIT 1`;
      if (!target.length) return res.status(404).json({ error: 'User not found' });
      const t = target[0];
      const token = generateSetupToken();
      const resetHours = 24;
      const expiresAt = new Date(Date.now() + resetHours * 60 * 60 * 1000);
      await sql`
        INSERT INTO setup_tokens (token, user_id, purpose, expires_at, created_by_user_id)
        VALUES (${token}, ${id}, 'reset', ${expiresAt.toISOString()}, ${user.id})
      `;
      // Try to email it; if Resend isn't set up, the admin still gets the link in the response.
      let emailed = false;
      if (isEmailConfigured()) {
        const setupUrl = `${originFromReq(req)}/?reset=${encodeURIComponent(token)}`;
        const tpl = resetTemplate({ inviteeName: t.name, setupUrl, hours: resetHours });
        const result = await sendEmail({ to: t.email, subject: 'Reset your Parts Store password', ...tpl });
        emailed = result.sent;
      }
      await logActivity({
        action: 'password_reset_link_generated',
        summary: `Generated a password-reset link for "${t.name}" (${t.email})${emailed ? ' — emailed' : ''}`,
        details: { userId: id, email: t.email, byUserId: user.id, byUserName: user.name, emailed },
        actor: user
      });
      return res.json({ token, expiresAt: expiresAt.toISOString(), expiresInHours: resetHours, emailed });
    }

    if (req.method === 'POST') {
      // Invite (create) a new user. Returns a setup link.
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const role = (body.role || 'user').toLowerCase();
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      const dup = await sql`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
      if (dup.length) return res.status(409).json({ error: 'A user with that email already exists' });

      const inserted = await sql`
        INSERT INTO users (email, name, role, invited_by_user_id, invited_at)
        VALUES (${email}, ${name}, ${role}, ${user.id}, NOW())
        RETURNING id, email, name, role, created_at::text AS "createdAt"
      `;
      const newUser = inserted[0];

      const token = generateSetupToken();
      const expiresAt = new Date(Date.now() + SETUP_TOKEN_HOURS * 60 * 60 * 1000);
      await sql`
        INSERT INTO setup_tokens (token, user_id, purpose, expires_at, created_by_user_id)
        VALUES (${token}, ${newUser.id}, 'invite', ${expiresAt.toISOString()}, ${user.id})
      `;

      let emailed = false;
      if (isEmailConfigured()) {
        const setupUrl = `${originFromReq(req)}/?setup=${encodeURIComponent(token)}`;
        const tpl = inviteTemplate({ inviterName: user.name, inviteeName: name, role, setupUrl, hours: SETUP_TOKEN_HOURS });
        const result = await sendEmail({ to: email, subject: `${user.name} invited you to Parts Store`, ...tpl });
        emailed = result.sent;
      }

      await logActivity({
        action: 'user_invited',
        summary: `Invited "${name}" (${email}) as ${role}${emailed ? ' — emailed' : ''}`,
        details: { invitedUserId: newUser.id, email, role, byUserId: user.id, byUserName: user.name, emailed },
        actor: user
      });

      return res.json({ user: newUser, setupToken: token, expiresAt: expiresAt.toISOString(), expiresInHours: SETUP_TOKEN_HOURS, emailed });
    }

    if (req.method === 'PUT') {
      // Change role of a user
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'User id required' });
      const body = await parseBody(req);
      const role = (body.role || '').toLowerCase();
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      if (id === user.id) return res.status(400).json({ error: 'You cannot change your own role' });

      const target = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
      if (!target.length) return res.status(404).json({ error: 'User not found' });
      const t = target[0];

      if (t.role === 'admin' && role !== 'admin') {
        if (await lastAdminProtection(id)) {
          return res.status(400).json({ error: 'Cannot demote the last remaining admin' });
        }
      }

      await sql`UPDATE users SET role = ${role} WHERE id = ${id}`;
      await logActivity({
        action: 'user_role_changed',
        summary: `Changed role of "${t.name}" (${t.email}): ${t.role} → ${role}`,
        details: { userId: id, oldRole: t.role, newRole: role, byUserId: user.id, byUserName: user.name },
        actor: user
      });
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'User id required' });
      if (id === user.id) return res.status(400).json({ error: 'You cannot remove yourself' });

      const target = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
      if (!target.length) return res.status(404).json({ error: 'User not found' });
      const t = target[0];

      if (t.role === 'admin' && await lastAdminProtection(id)) {
        return res.status(400).json({ error: 'Cannot remove the last remaining admin' });
      }

      await sql`DELETE FROM users WHERE id = ${id}`;
      await logActivity({
        action: 'user_removed',
        summary: `Removed user "${t.name}" (${t.email}, ${t.role})`,
        details: { userId: id, email: t.email, role: t.role, byUserId: user.id, byUserName: user.name },
        actor: user
      });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
