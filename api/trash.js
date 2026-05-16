const { sql, ensureTables, parseBody, normalizeModule, purgeOldTrash, TRASH_RETENTION_DAYS } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    await purgeOldTrash();

    if (req.method === 'GET') {
      const mod = normalizeModule(req.query.module);
      const rows = await sql`
        SELECT id, sku, name, category, machine, module, unit, qty,
               min_qty     AS "minQty",
               description AS "desc",
               deleted_at::text AS "deletedAt",
               (deleted_at + INTERVAL '7 days')::text AS "purgeAt"
        FROM parts
        WHERE module = ${mod} AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `;
      return res.json({ retentionDays: TRASH_RETENTION_DAYS, items: rows });
    }

    if (req.method === 'POST') {
      // Restore: clear deleted_at, but only if SKU isn't currently in use
      const { id } = await parseBody(req);
      if (!id) return res.status(400).json({ error: 'ID required' });
      const target = await sql`SELECT sku FROM parts WHERE id = ${id} AND deleted_at IS NOT NULL`;
      if (!target.length) return res.status(404).json({ error: 'Trashed part not found' });
      const skuVal = target[0].sku;
      if (skuVal) {
        const clash = await sql`
          SELECT id, sku, name FROM parts
          WHERE LOWER(sku) = LOWER(${skuVal}) AND deleted_at IS NULL AND id <> ${id}
          LIMIT 1
        `;
        if (clash.length) {
          return res.status(409).json({
            error: 'Cannot restore: SKU "' + skuVal + '" is already used by active part "' + clash[0].name + '". Rename or delete that one first.'
          });
        }
      }
      await sql`UPDATE parts SET deleted_at = NULL WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      // Permanent delete (skips retention window)
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'ID required' });
      await sql`DELETE FROM parts WHERE id = ${id} AND deleted_at IS NOT NULL`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
