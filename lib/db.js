const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id   SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS parts (
      id          SERIAL PRIMARY KEY,
      sku         TEXT,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      unit        TEXT    NOT NULL DEFAULT 'pcs',
      qty         INTEGER NOT NULL DEFAULT 0,
      min_qty     INTEGER NOT NULL DEFAULT 0,
      description TEXT             DEFAULT ''
    )
  `;
  await sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS sku TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS parts_sku_unique ON parts(sku) WHERE sku IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id        SERIAL  PRIMARY KEY,
      type      TEXT    NOT NULL CHECK (type IN ('in','out')),
      part_id   INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      qty       INTEGER NOT NULL,
      date      DATE    NOT NULL,
      ref       TEXT    DEFAULT '',
      notes     TEXT    DEFAULT '',
      issued_to TEXT    DEFAULT '',
      purpose   TEXT    DEFAULT ''
    )
  `;

  const existing = await sql`SELECT COUNT(*)::int AS c FROM categories`;
  if (existing[0].c === 0) {
    const defaults = ['Bearings','Inks','Belts','Seals','Filters','Fasteners','Lubricants','Electrical','Hydraulics','Other'];
    for (const name of defaults) {
      await sql`INSERT INTO categories (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
    }
  }
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

module.exports = { sql, ensureTables, parseBody };
