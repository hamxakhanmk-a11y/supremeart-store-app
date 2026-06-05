const { sql, ensureTables, parseBody, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    await ensureTables();
    const _user = await requireAuth(req, res);
    if (!_user) return;

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT t.id, t.type,
               t.part_id   AS "partId",
               t.qty,
               t.date::text AS date,
               t.ref, t.notes,
               t.issued_to AS "issuedTo",
               t.purpose
        FROM transactions t
        JOIN parts p ON p.id = t.part_id
        WHERE p.deleted_at IS NULL
        ORDER BY t.id DESC
      `;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { type, partId, qty, date, ref, notes, issuedTo, purpose } = await parseBody(req);
      const pid = parseInt(partId);
      const q   = parseInt(qty);
      if (!type || !pid || !q || !date) {
        return res.status(400).json({ error: 'type, partId, qty and date are required' });
      }

      const parts = await sql`SELECT qty FROM parts WHERE id = ${pid}`;
      if (!parts.length) return res.status(400).json({ error: 'Part not found' });

      if (type === 'out') {
        if (parts[0].qty < q) {
          return res.status(400).json({ error: `Not enough stock! Available: ${parts[0].qty}` });
        }
        await sql`UPDATE parts SET qty = qty - ${q} WHERE id = ${pid}`;
      } else {
        await sql`UPDATE parts SET qty = qty + ${q} WHERE id = ${pid}`;
      }

      const rows = await sql`
        INSERT INTO transactions (type, part_id, qty, date, ref, notes, issued_to, purpose)
        VALUES (
          ${type}, ${pid}, ${q}, ${date},
          ${ref || ''}, ${notes || ''}, ${issuedTo || ''}, ${purpose || ''}
        )
        RETURNING id, type,
                  part_id   AS "partId",
                  qty,
                  date::text AS date,
                  ref, notes,
                  issued_to AS "issuedTo",
                  purpose
      `;
      return res.json(rows[0]);
    }

    if (req.method === 'DELETE') {
      // Accept either ?id=123 (single) or body { ids: [...], historyOnly?: bool } (bulk)
      let ids, historyOnly = false;
      if (req.query.id) {
        const single = parseInt(req.query.id);
        if (!single) return res.status(400).json({ error: 'ID required' });
        ids = [single];
      } else {
        const body = await parseBody(req);
        if (Array.isArray(body.ids)) ids = body.ids.map(Number).filter(Boolean);
        historyOnly = body.historyOnly === true;
      }
      if (!ids || !ids.length) return res.status(400).json({ error: 'ID(s) required' });

      // Fetch full transaction details for both the qty reversal AND the activity log
      const txns = await sql`
        SELECT id, type, part_id AS "partId", qty, date::text AS date,
               ref, notes, issued_to AS "issuedTo", purpose
        FROM transactions WHERE id = ANY(${ids})
      `;
      if (!txns.length) return res.json({ ok: true, deleted: 0 });

      // Always fetch the affected parts (for log labels even in historyOnly mode)
      const partIds = Array.from(new Set(txns.map(t => t.partId)));
      const parts = await sql`SELECT id, name, sku, unit, module, qty FROM parts WHERE id = ANY(${partIds})`;
      const partsMap = Object.fromEntries(parts.map(p => [p.id, p]));

      if (!historyOnly) {
        // Normal delete: reverse qty changes
        const delta = {};
        for (const t of txns) {
          delta[t.partId] = (delta[t.partId] || 0) + (t.type === 'in' ? -t.qty : t.qty);
        }
        for (const pid of partIds) {
          const p = partsMap[pid];
          if (p && p.qty + delta[pid] < 0) {
            return res.status(400).json({
              error: `Cannot delete: would make "${p.name}" go below zero (current ${p.qty}, net reversal ${delta[pid]}). Adjust stock first or use 'Delete from History' to purge without reversing qty.`
            });
          }
        }
        for (const pid of partIds) {
          if (delta[pid] !== 0) {
            await sql`UPDATE parts SET qty = qty + ${delta[pid]} WHERE id = ${pid}`;
          }
        }
      }

      await sql`DELETE FROM transactions WHERE id = ANY(${ids})`;

      // Activity log: one entry per deleted txn
      const action = historyOnly ? 'txn_purged' : 'txn_deleted';
      for (const t of txns) {
        const p = partsMap[t.partId] || {};
        const verb = t.type === 'in' ? 'Stock In' : 'Stock Out';
        const sign = t.type === 'in' ? '+' : '-';
        const who = t.type === 'in' ? (t.ref || '—') : (t.issuedTo || '—');
        const partLabel = (p.sku ? `[${p.sku}] ` : '') + (p.name || ('part #' + t.partId));
        const prefix = historyOnly ? 'Purged from history' : 'Reversed';
        const summary = `${prefix} ${verb}: ${sign}${t.qty} ${p.unit || ''} of "${partLabel}" on ${t.date} (${t.type === 'in' ? 'ref' : 'to'}: ${who})`;
        await logActivity({
          action,
          summary,
          details: { ...t, partName: p.name, partSku: p.sku, partUnit: p.unit, historyOnly },
          module: p.module
        });
      }

      return res.json({ ok: true, deleted: txns.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
