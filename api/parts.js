const { sql, ensureTables, parseBody } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, category, unit, qty,
               min_qty     AS "minQty",
               description AS "desc"
        FROM parts ORDER BY id
      `;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { name, category, unit, minQty, desc } = await parseBody(req);
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      if (!category)             return res.status(400).json({ error: 'Category required' });
      const rows = await sql`
        INSERT INTO parts (name, category, unit, qty, min_qty, description)
        VALUES (
          ${name.trim()}, ${category}, ${unit || 'pcs'},
          0, ${minQty || 0}, ${desc || ''}
        )
        RETURNING id, name, category, unit, qty,
                  min_qty AS "minQty", description AS "desc"
      `;
      return res.json(rows[0]);
    }

    if (req.method === 'PUT') {
      const { id, name, category, unit, minQty, desc } = await parseBody(req);
      if (!id)                   return res.status(400).json({ error: 'ID required' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      await sql`
        UPDATE parts
        SET name = ${name.trim()}, category = ${category}, unit = ${unit},
            min_qty = ${minQty || 0}, description = ${desc || ''}
        WHERE id = ${id}
      `;
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'ID required' });
      await sql`DELETE FROM parts WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
