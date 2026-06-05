const { sql, ensureTables, logActivity } = require('../../lib/db');
const { requireAdmin, generateToken } = require('../../lib/auth');

const RESET_TOKEN_HOURS = 24;

module.exports = async (req, res) => {
  try {
    await ensureTables();
    const user = await requireAdmin(req, res);
    if (!user) return;

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const id = parseInt(req.query.id);
    if (!id) return res.status(400).json({ error: 'User id required' });

    const target = await sql`SELECT id, email, name FROM users WHERE id = ${id} LIMIT 1`;
    if (!target.length) return res.status(404).json({ error: 'User not found' });
    const t = target[0];

    const token = generateToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
    await sql`
      INSERT INTO setup_tokens (token, user_id, purpose, expires_at, created_by_user_id)
      VALUES (${token}, ${id}, 'reset', ${expiresAt.toISOString()}, ${user.id})
    `;

    await logActivity({
      action: 'password_reset_link_generated',
      summary: `Generated a password-reset link for "${t.name}" (${t.email})`,
      details: { userId: id, email: t.email, byUserId: user.id, byUserName: user.name }
    });

    return res.json({ token, expiresAt: expiresAt.toISOString(), expiresInHours: RESET_TOKEN_HOURS });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
