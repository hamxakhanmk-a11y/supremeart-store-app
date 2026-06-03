const { sql, ensureTables, normalizeModule } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const mod = normalizeModule(req.query.module);
      const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
      // Include the current module's events PLUS events with NULL module
      // (legacy or non-module-scoped entries shouldn't disappear)
      const rows = await sql`
        SELECT id, action, summary, details,
               module,
               created_at::text AS "createdAt"
        FROM activity_log
        WHERE module = ${mod} OR module IS NULL
        ORDER BY id DESC
        LIMIT ${limit}
      `;
      return res.json(rows);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
