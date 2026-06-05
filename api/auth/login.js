const { sql, ensureTables, parseBody } = require('../../lib/db');
const { verifyPassword, createSession, setSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password } = await parseBody(req);
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const rows = await sql`SELECT id, email, name, role, password_hash FROM users WHERE LOWER(email) = LOWER(${email.trim()}) LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const u = rows[0];
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    const token = await createSession(u.id);
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${u.id}`;
    setSessionCookie(res, token);
    return res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
