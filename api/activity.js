const { sql, ensureTables, normalizeModule } = require('../lib/db');
const { requireRead } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    const _user = await requireRead(req, res);
    if (!_user) return;

    if (req.method === 'GET') {
      const mod = normalizeModule(req.query.module);
      const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
      const userId = req.query.userId ? parseInt(req.query.userId) : null;
      if (userId) {
        const rows = await sql`
          SELECT id, action, summary, details, module,
                 created_at::text AS "createdAt",
                 user_id AS "userId", user_email AS "userEmail", user_name AS "userName"
          FROM activity_log
          WHERE (module = ${mod} OR module IS NULL) AND user_id = ${userId}
          ORDER BY id DESC
          LIMIT ${limit}
        `;
        return res.json(rows);
      }
      const rows = await sql`
        SELECT id, action, summary, details, module,
               created_at::text AS "createdAt",
               user_id AS "userId", user_email AS "userEmail", user_name AS "userName"
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
