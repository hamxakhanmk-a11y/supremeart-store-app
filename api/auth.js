// Consolidated auth endpoint. Action chosen via ?action=...
//   GET  ?action=me             -> current session info (+ needsSetup flag)
//   POST ?action=login          -> email+password sign-in
//   POST ?action=logout         -> sign out, clear cookie
//   POST ?action=setup          -> create first admin (only when no users exist)
//   GET  ?action=set-password   -> validate a setup/reset token
//   POST ?action=set-password   -> set password from token + sign in

const { sql, ensureTables, parseBody, logActivity } = require('../lib/db');
const {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  getSession,
  countUsers,
  generateToken
} = require('../lib/auth');
const { sendEmail, isEmailConfigured, resetTemplate } = require('../lib/email');

function originFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  try {
    await ensureTables();
    const action = (req.query.action || '').toLowerCase();

    // -------------------- me --------------------
    if (action === 'me') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const user = await getSession(req);
      if (user) return res.json({ authenticated: true, needsSetup: false, user, emailConfigured: isEmailConfigured() });
      const total = await countUsers();
      return res.json({ authenticated: false, needsSetup: total === 0, emailConfigured: isEmailConfigured() });
    }

    // -------------------- login --------------------
    if (action === 'login') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { email, password } = await parseBody(req);
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const rows = await sql`
        SELECT id, email, name, role, password_hash
        FROM users WHERE LOWER(email) = LOWER(${email.trim()}) LIMIT 1
      `;
      if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
      const u = rows[0];
      if (!u.password_hash) return res.status(401).json({ error: 'This account has not finished setup. Ask an admin for a fresh invite link.' });
      const ok = await verifyPassword(password, u.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      const token = await createSession(u.id);
      await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${u.id}`;
      setSessionCookie(res, token);
      return res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
    }

    // -------------------- logout --------------------
    if (action === 'logout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const token = parseCookies(req)[COOKIE_NAME];
      if (token) {
        try { await sql`DELETE FROM sessions WHERE token = ${token}`; } catch (_) { /* ignore */ }
      }
      clearSessionCookie(res);
      return res.json({ ok: true });
    }

    // -------------------- setup (first admin) --------------------
    if (action === 'setup') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const total = await countUsers();
      if (total > 0) return res.status(403).json({ error: 'Setup has already been completed' });
      const { name, email, password } = await parseBody(req);
      const nameT = (name || '').trim();
      const emailT = (email || '').trim();
      if (!nameT) return res.status(400).json({ error: 'Name required' });
      if (!emailT || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailT)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const hash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO users (email, name, password_hash, role)
        VALUES (${emailT.toLowerCase()}, ${nameT}, ${hash}, 'admin')
        RETURNING id, email, name, role
      `;
      const u = rows[0];
      const token = await createSession(u.id);
      await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${u.id}`;
      setSessionCookie(res, token);
      return res.json({ user: u });
    }

    // -------------------- set-password (invite / reset) --------------------
    if (action === 'set-password') {
      if (req.method === 'GET') {
        const token = req.query.token;
        if (!token) return res.status(400).json({ error: 'Token required' });
        const rows = await sql`
          SELECT t.purpose, t.expires_at, t.used_at, u.email, u.name
          FROM setup_tokens t
          JOIN users u ON u.id = t.user_id
          WHERE t.token = ${token}
          LIMIT 1
        `;
        if (!rows.length) return res.status(404).json({ valid: false, error: 'Invalid link' });
        const r = rows[0];
        if (r.used_at) return res.status(410).json({ valid: false, error: 'This link has already been used' });
        if (new Date(r.expires_at) < new Date()) return res.status(410).json({ valid: false, error: 'This link has expired' });
        return res.json({ valid: true, purpose: r.purpose, name: r.name, email: r.email });
      }
      if (req.method === 'POST') {
        const { token, password } = await parseBody(req);
        if (!token) return res.status(400).json({ error: 'Token required' });
        if (!password || password.length < 8) {
          return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        const rows = await sql`
          SELECT t.user_id, t.expires_at, t.used_at
          FROM setup_tokens t
          WHERE t.token = ${token}
          LIMIT 1
        `;
        if (!rows.length) return res.status(404).json({ error: 'Invalid link' });
        const r = rows[0];
        if (r.used_at) return res.status(410).json({ error: 'This link has already been used' });
        if (new Date(r.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired' });
        const hash = await hashPassword(password);
        await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${r.user_id}`;
        await sql`UPDATE setup_tokens SET used_at = NOW() WHERE token = ${token}`;
        await sql`UPDATE setup_tokens SET used_at = NOW() WHERE user_id = ${r.user_id} AND used_at IS NULL`;
        const sessionToken = await createSession(r.user_id);
        await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${r.user_id}`;
        setSessionCookie(res, sessionToken);
        const u = await sql`SELECT id, email, name, role FROM users WHERE id = ${r.user_id}`;
        return res.json({ user: u[0] });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // -------------------- change-password (logged-in user) --------------------
    if (action === 'change-password') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const user = await getSession(req);
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const { currentPassword, newPassword } = await parseBody(req);
      if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
      const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id} LIMIT 1`;
      if (!rows.length || !rows[0].password_hash) return res.status(400).json({ error: 'Account is in an unexpected state' });
      const ok = await verifyPassword(currentPassword, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
      const hash = await hashPassword(newPassword);
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
      // Optional: invalidate other sessions so old cookies elsewhere are kicked out
      const cookieToken = parseCookies(req)[COOKIE_NAME];
      await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND token <> ${cookieToken}`;
      await logActivity({
        action: 'password_self_changed',
        summary: `Changed own password`,
        details: { userId: user.id },
        actor: user
      });
      return res.json({ ok: true });
    }

    // -------------------- forgot-password (public, rate-limited by token expiry) --------------------
    if (action === 'forgot-password') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { email } = await parseBody(req);
      const emailT = (email || '').trim().toLowerCase();
      // Always return generic success so callers can't probe for valid emails.
      const generic = { ok: true, emailConfigured: isEmailConfigured() };
      if (!emailT || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailT)) return res.json(generic);
      if (!isEmailConfigured()) return res.json(generic); // Without Resend, do nothing silently
      const rows = await sql`SELECT id, email, name FROM users WHERE LOWER(email) = ${emailT} LIMIT 1`;
      if (!rows.length) return res.json(generic);
      const u = rows[0];
      const token = generateToken();
      const hours = 24;
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      await sql`
        INSERT INTO setup_tokens (token, user_id, purpose, expires_at)
        VALUES (${token}, ${u.id}, 'reset', ${expiresAt.toISOString()})
      `;
      const setupUrl = `${originFromReq(req)}/?reset=${encodeURIComponent(token)}`;
      const tpl = resetTemplate({ inviteeName: u.name, setupUrl, hours });
      await sendEmail({ to: u.email, subject: 'Reset your Parts Store password', ...tpl });
      await logActivity({
        action: 'password_reset_requested',
        summary: `Self-service password reset requested for "${u.name}" (${u.email})`,
        details: { userId: u.id, email: u.email }
      });
      return res.json(generic);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
