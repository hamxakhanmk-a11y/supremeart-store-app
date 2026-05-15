const { sql, ensureTables, parseBody } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, type,
               part_id   AS "partId",
               qty,
               date::text AS date,
               ref, notes,
               issued_to AS "issuedTo",
               purpose
        FROM transactions ORDER BY id DESC
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
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'ID required' });

      const txns = await sql`SELECT * FROM transactions WHERE id = ${id}`;
      if (!txns.length) return res.status(404).json({ error: 'Transaction not found' });
      const txn = txns[0];

      if (txn.type === 'in') {
        const parts = await sql`SELECT qty FROM parts WHERE id = ${txn.part_id}`;
        if (parts.length && parts[0].qty < txn.qty) {
          return res.status(400).json({
            error: `Cannot delete: current stock (${parts[0].qty}) is less than this record's qty (${txn.qty}). Adjust stock first.`
          });
        }
        await sql`UPDATE parts SET qty = qty - ${txn.qty} WHERE id = ${txn.part_id}`;
      } else {
        await sql`UPDATE parts SET qty = qty + ${txn.qty} WHERE id = ${txn.part_id}`;
      }

      await sql`DELETE FROM transactions WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
