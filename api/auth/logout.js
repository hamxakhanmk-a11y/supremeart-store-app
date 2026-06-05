const { sql, ensureTables } = require('../../lib/db');
const { COOKIE_NAME, parseCookies, clearSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      try { await sql`DELETE FROM sessions WHERE token = ${token}`; } catch (e) { /* ignore */ }
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
