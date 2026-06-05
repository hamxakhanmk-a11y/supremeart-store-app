const { ensureTables } = require('../../lib/db');
const { getSession, countUsers } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const user = await getSession(req);
    if (user) return res.json({ authenticated: true, needsSetup: false, user });
    const total = await countUsers();
    return res.json({ authenticated: false, needsSetup: total === 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
