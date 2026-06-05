const { sql, ensureTables, parseBody } = require('../../lib/db');
const { hashPassword, createSession, setSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    if (req.method === 'GET') {
      // Lookup: is this token valid? (Used by the set-password screen to show
      // the user's name and tell them whether they're invited vs. resetting.)
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

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    // Invalidate any other unused tokens for this user (so a stale reset link can't be reused)
    await sql`UPDATE setup_tokens SET used_at = NOW() WHERE user_id = ${r.user_id} AND used_at IS NULL`;

    // Sign the user in
    const sessionToken = await createSession(r.user_id);
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${r.user_id}`;
    setSessionCookie(res, sessionToken);

    const u = await sql`SELECT id, email, name, role FROM users WHERE id = ${r.user_id}`;
    return res.json({ user: u[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
