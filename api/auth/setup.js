const { sql, ensureTables, parseBody } = require('../../lib/db');
const { hashPassword, createSession, setSessionCookie, countUsers } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Only allowed when there are no users yet
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
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
