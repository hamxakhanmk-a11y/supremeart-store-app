const { ensureTables } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureTables();
    return res.json({ ok: true, message: 'Tables ready' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
