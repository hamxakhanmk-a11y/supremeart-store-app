const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('./db');

const COOKIE_NAME = 'pstore_session';
const SESSION_DAYS = 30;

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.email, u.name, u.role, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role };
}

const ROLES = ['admin', 'machinery', 'consumables', 'ceo'];
const WRITE_ROLES = ['admin', 'machinery', 'consumables'];
const ADMIN_ROLES = ['admin'];

// Wraps a handler: ensures the request has a valid session, otherwise sends 401.
// If allowedRoles is given, also enforces role membership (403 otherwise).
// Returns the user object, or null (caller should return early if null).
async function requireAuth(req, res, allowedRoles) {
  const user = await getSession(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    res.status(403).json({ error: 'You don’t have permission to perform this action' });
    return null;
  }
  return user;
}

function isWriteMethod(method) {
  return method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
}

// Authorize based on HTTP method: GET allowed for all signed-in users,
// writes restricted to admin + user (not CEO).
async function requireRead(req, res) {
  return requireAuth(req, res); // any signed-in user
}
async function requireWrite(req, res) {
  return requireAuth(req, res, WRITE_ROLES);
}
async function requireAdmin(req, res) {
  return requireAuth(req, res, ADMIN_ROLES);
}
async function requireByMethod(req, res) {
  if (isWriteMethod(req.method)) return requireWrite(req, res);
  return requireRead(req, res);
}

async function countUsers() {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM users`;
  return rows[0].c;
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt.toISOString()})`;
  return token;
}

async function purgeExpiredSessions() {
  try {
    await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
  } catch (e) {
    console.error('purge sessions failed:', e.message);
  }
}

module.exports = {
  COOKIE_NAME,
  ROLES,
  WRITE_ROLES,
  ADMIN_ROLES,
  hashPassword,
  verifyPassword,
  generateToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth,
  requireRead,
  requireWrite,
  requireAdmin,
  requireByMethod,
  countUsers,
  createSession,
  purgeExpiredSessions
};
