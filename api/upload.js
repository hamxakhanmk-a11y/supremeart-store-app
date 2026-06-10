// Image upload endpoint — accepts raw bytes from the browser and stores
// them in Vercel Blob. The browser already resizes/compresses to JPEG
// (~1200px max edge) before posting, so payloads are well under the
// 4.5 MB serverless body limit.
const { put, del } = require('@vercel/blob');
const { requireWrite } = require('../lib/auth');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && Buffer.isBuffer(req.body)) return resolve(req.body);
    if (req.body && typeof req.body === 'string') return resolve(Buffer.from(req.body));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  try {
    const user = await requireWrite(req, res);
    if (!user) return;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: 'Image storage is not configured (BLOB_READ_WRITE_TOKEN missing). Create a Vercel Blob store in the project Storage tab.' });
    }

    // DELETE: remove a previously uploaded image when a part is updated/deleted
    if (req.method === 'DELETE') {
      const url = req.query.url;
      if (!url) return res.status(400).json({ error: 'url required' });
      try { await del(url); } catch (_) { /* ignore — file may already be gone */ }
      return res.json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const contentType = req.headers['content-type'] || 'image/jpeg';
    if (!/^image\//.test(contentType)) {
      return res.status(400).json({ error: 'Only image uploads are accepted' });
    }

    const rawName = (req.query.filename || 'part.jpg').toString();
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const body = await readRawBody(req);
    if (!body.length) return res.status(400).json({ error: 'Empty upload' });
    if (body.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (5 MB max)' });

    const key = `parts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const blob = await put(key, body, {
      access: 'public',
      contentType,
      addRandomSuffix: false
    });
    return res.json({ url: blob.url, pathname: blob.pathname });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
