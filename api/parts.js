const { sql, ensureTables, parseBody, normalizeModule } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const mod = normalizeModule(req.query.module);
      const rows = await sql`
        SELECT id, sku, name, category, module, unit, qty,
               min_qty     AS "minQty",
               description AS "desc"
        FROM parts
        WHERE module = ${mod}
        ORDER BY id
      `;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const mod = normalizeModule(body.module);
      const { sku, name, category, unit, minQty, desc } = body;
      if (!sku  || !sku.trim())  return res.status(400).json({ error: 'SKU / Part No. required' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      if (!category)             return res.status(400).json({ error: 'Category required' });
      const skuTrim = sku.trim();
      // Case-insensitive lookup across ALL modules
      const dup = await sql`
        SELECT id, sku, name, category, module, unit, qty,
               min_qty AS "minQty", description AS "desc"
        FROM parts
        WHERE LOWER(sku) = LOWER(${skuTrim})
        LIMIT 1
      `;
      if (dup.length > 0) {
        return res.status(409).json({
          error: 'SKU "' + dup[0].sku + '" already exists',
          existing: dup[0]
        });
      }
      const rows = await sql`
        INSERT INTO parts (sku, name, category, module, unit, qty, min_qty, description)
        VALUES (
          ${skuTrim}, ${name.trim()}, ${category}, ${mod}, ${unit || 'pcs'},
          0, ${minQty || 0}, ${desc || ''}
        )
        RETURNING id, sku, name, category, module, unit, qty,
                  min_qty AS "minQty", description AS "desc"
      `;
      return res.json(rows[0]);
    }

    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const { id, sku, name, category, unit, minQty, desc } = body;
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
