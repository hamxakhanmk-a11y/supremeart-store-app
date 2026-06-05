// Lightweight Resend wrapper. If RESEND_API_KEY isn't set, sendEmail
// returns { sent: false } instead of throwing — the caller decides
// whether to fall back to manual link delivery.

const RESEND_API_URL = 'https://api.resend.com/emails';

function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function defaultSender() {
  // Resend sandbox sender works out-of-the-box; verified domain optional.
  return process.env.EMAIL_FROM || 'Parts Store <onboarding@resend.dev>';
}

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'not_configured' };
  if (!to || !subject || (!html && !text)) {
    return { sent: false, reason: 'missing_fields' };
  }
  try {
    const r = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: defaultSender(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text
      })
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.error('Resend send failed:', r.status, err);
      return { sent: false, reason: 'send_failed', status: r.status, error: err };
    }
    return { sent: true };
  } catch (e) {
    console.error('Resend exception:', e.message);
    return { sent: false, reason: 'exception', error: e.message };
  }
}

function inviteTemplate({ inviterName, inviteeName, role, setupUrl, hours }) {
  const roleLabel = role === 'ceo' ? 'CEO (view-only)' : role.charAt(0).toUpperCase() + role.slice(1);
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h2 style="color:#185FA5;margin:0 0 16px">You've been invited to Parts Store</h2>
      <p>Hi ${escapeHtml(inviteeName)},</p>
      <p><b>${escapeHtml(inviterName)}</b> has added you as a <b>${roleLabel}</b> on the Parts Store stock management system.</p>
      <p>Click the button below to set your password and finish creating your account:</p>
      <p style="margin:24px 0">
        <a href="${setupUrl}" style="background:#185FA5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Set Your Password</a>
      </p>
      <p style="color:#888;font-size:13px">Or copy this link into your browser:<br><span style="word-break:break-all">${setupUrl}</span></p>
      <p style="color:#888;font-size:13px">This link expires in ${hours} hours.</p>
    </div>
  `;
  const text = `Hi ${inviteeName},\n\n${inviterName} has added you as a ${roleLabel} on the Parts Store stock management system.\n\nSet your password here: ${setupUrl}\n\nThis link expires in ${hours} hours.`;
  return { html, text };
}

function resetTemplate({ inviteeName, setupUrl, hours }) {
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h2 style="color:#185FA5;margin:0 0 16px">Reset your password</h2>
      <p>Hi ${escapeHtml(inviteeName)},</p>
      <p>You (or an admin) requested a password reset for your Parts Store account.</p>
      <p style="margin:24px 0">
        <a href="${setupUrl}" style="background:#185FA5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Set a New Password</a>
      </p>
      <p style="color:#888;font-size:13px">Or copy this link into your browser:<br><span style="word-break:break-all">${setupUrl}</span></p>
      <p style="color:#888;font-size:13px">This link expires in ${hours} hours. If you didn't request this, you can safely ignore the email.</p>
    </div>
  `;
  const text = `Hi ${inviteeName},\n\nReset your Parts Store password here: ${setupUrl}\n\nThis link expires in ${hours} hours.`;
  return { html, text };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

module.exports = { sendEmail, isEmailConfigured, inviteTemplate, resetTemplate };
