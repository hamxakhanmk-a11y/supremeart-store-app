const { sql, ensureTables, parseBody, normalizeModule } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const mod = normalizeModule(req.query.module);
      const rows = await sql`SELECT name FROM machines WHERE module = ${mod} ORDER BY name`;
      return res.json(rows.map(r => r.name));
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const mod = normalizeModule(body.module);
      const name = (body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      await sql`
        INSERT INTO machines (name, module) VALUES (${name}, ${mod})
        ON CONFLICT (module, name) DO NOTHING
      `;
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const name = req.query.name;
      const mod = normalizeModule(req.query.module);
      if (!name) return res.status(400).json({ error: 'Name required' });
      const used = await sql`SELECT id FROM parts WHERE machine = ${name} AND module = ${mod} AND deleted_at IS NULL LIMIT 1`;
      if (used.length > 0) {
        return res.status(400).json({ error: 'Cannot delete: parts are assigned to this machine. Reassign them first.' });
      }
      await sql`DELETE FROM machines WHERE name = ${name} AND module = ${mod}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
