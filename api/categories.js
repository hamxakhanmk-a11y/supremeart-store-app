const { sql, ensureTables, parseBody } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const rows = await sql`SELECT name FROM categories ORDER BY name`;
      return res.json(rows.map(r => r.name));
    }

    if (req.method === 'POST') {
      const { name } = await parseBody(req);
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      await sql`INSERT INTO categories (name) VALUES (${name.trim()}) ON CONFLICT (name) DO NOTHING`;
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const name = req.query.name;
      if (!name) return res.status(400).json({ error: 'Name required' });
      const used = await sql`SELECT id FROM parts WHERE category = ${name} LIMIT 1`;
      if (used.length > 0) {
        return res.status(400).json({ error: 'Cannot delete: parts are using this category. Reassign them first.' });
      }
      await sql`DELETE FROM categories WHERE name = ${name}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
