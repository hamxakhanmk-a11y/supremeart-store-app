const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const MODULES = ['machinery', 'consumables'];

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id     SERIAL PRIMARY KEY,
      name   TEXT NOT NULL,
      module TEXT NOT NULL DEFAULT 'machinery'
    )
  `;
  // Migration: add module col if table pre-existed without it
  await sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS module TEXT NOT NULL DEFAULT 'machinery'`;
  // Replace any old global unique(name) with composite unique(module,name)
  await sql`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS categories_module_name_key ON categories(module, name)`;

  await sql`
    CREATE TABLE IF NOT EXISTS parts (
      id          SERIAL PRIMARY KEY,
      sku         TEXT,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      module      TEXT    NOT NULL DEFAULT 'machinery',
      unit        TEXT    NOT NULL DEFAULT 'pcs',
      qty         INTEGER NOT NULL DEFAULT 0,
      min_qty     INTEGER NOT NULL DEFAULT 0,
      description TEXT             DEFAULT ''
    )
  `;
  await sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS sku TEXT`;
  await sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS module TEXT NOT NULL DEFAULT 'machinery'`;
  await sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS machine TEXT DEFAULT ''`;

  await sql`
    CREATE TABLE IF NOT EXISTS machines (
      id     SERIAL PRIMARY KEY,
      name   TEXT NOT NULL,
      module TEXT NOT NULL DEFAULT 'machinery'
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS machines_module_name_key ON machines(module, name)`;
  // Case-insensitive unique SKU among ACTIVE (non-trashed) parts only,
  // so an SKU becomes reusable once its part is moved to trash.
  await sql`DROP INDEX IF EXISTS parts_sku_unique`;
  await sql`DROP INDEX IF EXISTS parts_sku_unique_ci`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS parts_sku_active_unique_ci ON parts(LOWER(sku)) WHERE sku IS NOT NULL AND deleted_at IS NULL`;

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

  // Seed default machinery categories on first run
  const existing = await sql`SELECT COUNT(*)::int AS c FROM categories WHERE module = 'machinery'`;
  if (existing[0].c === 0) {
    const defaults = ['Bearings','Belts','Seals','Filters','Fasteners','Lubricants','Electrical','Hydraulics','Other'];
    for (const name of defaults) {
      await sql`INSERT INTO categories (name, module) VALUES (${name}, 'machinery') ON CONFLICT (module, name) DO NOTHING`;
    }
  }
}

function normalizeModule(m) {
  return MODULES.includes(m) ? m : 'machinery';
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

const TRASH_RETENTION_DAYS = 7;

async function purgeOldTrash() {
  // Permanently delete parts soft-deleted more than 7 days ago.
  // FK ON DELETE CASCADE removes their transactions too.
  await sql`DELETE FROM parts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '7 days'`;
}

module.exports = { sql, ensureTables, parseBody, normalizeModule, MODULES, purgeOldTrash, TRASH_RETENTION_DAYS };
