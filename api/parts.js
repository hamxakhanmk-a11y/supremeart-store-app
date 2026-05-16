const { sql, ensureTables, parseBody } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, sku, name, category, unit, qty,
               min_qty     AS "minQty",
               description AS "desc"
        FROM parts ORDER BY id
      `;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { sku, name, category, unit, minQty, desc } = await parseBody(req);
      if (!sku  || !sku.trim())  return res.status(400).json({ error: 'SKU / Part No. required' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      if (!category)             return res.status(400).json({ error: 'Category required' });
      try {
        const rows = await sql`
          INSERT INTO parts (sku, name, category, unit, qty, min_qty, description)
          VALUES (
            ${sku.trim()}, ${name.trim()}, ${category}, ${unit || 'pcs'},
            0, ${minQty || 0}, ${desc || ''}
          )
          RETURNING id, sku, name, category, unit, qty,
                    min_qty AS "minQty", description AS "desc"
        `;
        return res.json(rows[0]);
      } catch (e) {
        if (String(e.message).includes('parts_sku_unique') || e.code === '23505') {
          return res.status(409).json({ error: 'SKU "' + sku.trim() + '" already exists' });
        }
        throw e;
      }
    }

    if (req.method === 'PUT') {
      const { id, sku, name, category, unit, minQty, desc } = await parseBody(req);
      if (!id)                   return res.status(400).json({ error: 'ID required' });
      if (!sku  || !sku.trim())  return res.status(400).json({ error: 'SKU / Part No. required' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      try {
        await sql`
          UPDATE parts
          SET sku = ${sku.trim()}, name = ${name.trim()}, category = ${category},
              unit = ${unit}, min_qty = ${minQty || 0}, description = ${desc || ''}
          WHERE id = ${id}
        `;
        return res.json({ ok: true });
      } catch (e) {
        if (String(e.message).includes('parts_sku_unique') || e.code === '23505') {
          return res.status(409).json({ error: 'SKU "' + sku.trim() + '" already exists' });
        }
        throw e;
      }
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
