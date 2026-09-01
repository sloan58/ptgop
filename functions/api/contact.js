/* =========================================================
   POST /api/contact  (Cloudflare Pages Function)

   The contact form posts here. Everything goes through Brevo,
   as it did on the old WordPress site:

     1. Emails the note to the committee inbox via Brevo's
        transactional API, reply-to set to the visitor.
     2. If the visitor ticked the consent box, upserts them as a
        Brevo contact (name, email, phone) on the committee's list.

   Configuration — Cloudflare dashboard → Pages project → Settings
   → Variables and secrets (set for BOTH Production and Preview):

     BREVO_API_KEY   secret  Brevo → SMTP & API → API keys
     BREVO_LIST_ID   text    Brevo → Contacts → Lists; id is in the URL
     CONTACT_TO      text    optional; inbox for notes (default info@ptgop.com)
     CONTACT_FROM    text    optional; must be a verified Brevo sender
                             (default info@ptgop.com)

   Locally: copy .dev.vars.example → .dev.vars, then
     npx wrangler pages dev .
   ========================================================= */

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';
const BREVO_EMAIL_URL    = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_INBOX      = 'info@ptgop.com';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  return handleContact(context);
}

async function handleContact({ request, env, waitUntil }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Expected form data' }, 400);
  }

  const field = (k) => (form.get(k) ?? '').toString().trim();

  // Honeypot: real visitors never see this input. Bots fill it.
  // Pretend it worked so they don't learn anything.
  if (field('_gotcha')) return json({ ok: true });

  const name    = field('name');
  const email   = field('email');
  const phone   = field('phone');
  const address = field('address');
  const message = field('message');
  const consent = form.get('consent') != null;

  if (!name)           return json({ ok: false, error: 'Please tell us your name.' }, 400);
  if (!isEmail(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  if (!message)        return json({ ok: false, error: 'Please include a message.' }, 400);

  let phoneE164 = null;
  if (phone) {
    phoneE164 = normalizePhone(phone);
    if (!phoneE164) {
      return json({ ok: false, error: 'Please enter a valid phone number, e.g. (724) 555-0123.' }, 400);
    }
  }

  if (!env.BREVO_API_KEY) {
    console.error('BREVO_API_KEY is not set; cannot deliver contact form notes.');
    return json({ ok: false, error: 'The contact form is not configured yet. Please email info@ptgop.com directly.' }, 500);
  }

  // 1. The note itself — this one has to succeed.
  const sent = await emailNote(env, { name, email, phone: phoneE164, address, message, consent });
  if (!sent.ok) {
    console.error('Brevo email send failed:', sent.error);
    return json({ ok: false, error: 'Something went wrong sending your note. Please try again, or email info@ptgop.com directly.' }, 502);
  }

  // 2. Contact list — only with consent, and never at the expense
  //    of the note. Finishes after the response is sent.
  if (consent) {
    waitUntil(
      addToBrevo(env, { name, email, phone: phoneE164 }).catch((err) => {
        console.error('Brevo contact upsert failed:', err);
      })
    );
  }

  return json({ ok: true });
}

/* ---------- Brevo: transactional email ---------- */

async function emailNote(env, f) {
  const to   = env.CONTACT_TO   || DEFAULT_INBOX;
  const from = env.CONTACT_FROM || DEFAULT_INBOX;

  const rows = [
    ['Name',    f.name],
    ['Email',   f.email],
    ['Phone',   f.phone || '—'],
    ['Address', f.address || '—'],
    ['Consent', f.consent ? 'Yes — agreed to email and text updates' : 'No']
  ];

  const textContent =
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nMessage:\n${f.message}\n\n— Sent from the contact form at ptgop.com`;

  const htmlContent =
    `<table cellpadding="4" style="font-family:sans-serif;font-size:15px">` +
    rows.map(([k, v]) => `<tr><td style="color:#555"><b>${k}</b></td><td>${escapeHtml(v)}</td></tr>`).join('') +
    `</table>` +
    `<p style="font-family:sans-serif;font-size:15px;white-space:pre-wrap">${escapeHtml(f.message)}</p>` +
    `<p style="font-family:sans-serif;font-size:12px;color:#888">Sent from the contact form at ptgop.com</p>`;

  const payload = {
    sender:  { name: 'ptgop.com contact form', email: from },
    to:      [{ email: to, name: 'Peters Township Republican Committee' }],
    replyTo: { email: f.email, name: f.name },
    subject: `Note from ${f.name} via ptgop.com`,
    textContent,
    htmlContent,
    tags: ['contact-form']
  };

  try {
    const res = await brevoFetch(env, BREVO_EMAIL_URL, payload);
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.message || `Brevo HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Brevo unreachable: ${err.message}` };
  }
}

/* ---------- Brevo: contact list ---------- */

async function addToBrevo(env, { name, email, phone }) {
  const listId = Number.parseInt(env.BREVO_LIST_ID, 10);
  if (!Number.isFinite(listId)) {
    console.warn('BREVO_LIST_ID not set; contact will be created without a list.');
  }

  const { first, last } = splitName(name);
  const attributes = { FIRSTNAME: first, LASTNAME: last };
  if (phone) attributes.SMS = phone;

  const payload = {
    email,
    attributes,
    updateEnabled: true,               // existing contact → update, don't 400
    ...(Number.isFinite(listId) ? { listIds: [listId] } : {})
  };

  let result = await brevoUpsert(env, payload);

  // Brevo refuses an SMS number already attached to a different
  // contact. Keep the email/list membership; just drop the phone.
  if (!result.ok && phone && /sms/i.test(result.error)) {
    console.warn(`Brevo rejected SMS for ${email} (${result.error}); retrying without phone.`);
    delete payload.attributes.SMS;
    result = await brevoUpsert(env, payload);
  }

  if (!result.ok) throw new Error(result.error);
}

async function brevoUpsert(env, payload) {
  const res = await brevoFetch(env, BREVO_CONTACTS_URL, payload);

  // 201 = created, 204 = updated an existing contact (updateEnabled)
  if (res.ok) return { ok: true };

  const data = await res.json().catch(() => null);
  return { ok: false, error: data?.message || `Brevo HTTP ${res.status}` };
}

function brevoFetch(env, url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

/* ---------- helpers ---------- */

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Brevo wants E.164 (+14125550123). Accept the ways people
 * actually type a US number, and anything already international.
 */
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10)                           return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function splitName(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}
