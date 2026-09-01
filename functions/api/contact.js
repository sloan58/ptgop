/* =========================================================
   POST /api/contact  (Cloudflare Pages Function)

   The contact form posts here instead of straight to Formspree.
   This does two things the browser can't do safely on its own:

     1. Forwards the note to Formspree so the committee still
        gets the email it always has.
     2. If the visitor ticked the consent box, upserts them as a
        Brevo contact (name, email, phone) on the committee's
        list — the same list the old WordPress site fed.

   Configuration — Cloudflare dashboard → Pages project → Settings
   → Environment variables (set for BOTH Production and Preview):

     BREVO_API_KEY       secret   Brevo → SMTP & API → API keys
     BREVO_LIST_ID       plain    Brevo → Contacts → Lists; id is in the URL
     FORMSPREE_ENDPOINT  plain    optional; defaults to the committee's form

   Locally: copy .dev.vars.example → .dev.vars, then
     npx wrangler pages dev .
   ========================================================= */

const DEFAULT_FORMSPREE = 'https://formspree.io/f/mkokqgjg';
const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';

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

  // 1. Formspree — the committee's inbox. This one has to succeed.
  const formspree = await sendToFormspree(env, request, { name, email, phone: phoneE164, address, message, consent });
  if (!formspree.ok) {
    console.error('Formspree rejected submission:', formspree.error);
    return json({ ok: false, error: formspree.error }, 502);
  }

  // 2. Brevo — only with consent, and never at the expense of the
  //    note itself. Finishes after the response is sent.
  if (consent) {
    waitUntil(
      addToBrevo(env, { name, email, phone: phoneE164 }).catch((err) => {
        console.error('Brevo contact upsert failed:', err);
      })
    );
  }

  return json({ ok: true });
}

/* ---------- Formspree ---------- */

async function sendToFormspree(env, request, fields) {
  const endpoint = env.FORMSPREE_ENDPOINT || DEFAULT_FORMSPREE;

  const body = new FormData();
  body.set('name',     fields.name);
  body.set('email',    fields.email);
  body.set('_replyto', fields.email);          // reply from the inbox goes to the sender
  if (fields.phone)    body.set('phone', fields.phone);
  body.set('address',  fields.address);
  body.set('message',  fields.message);
  body.set('consent',  fields.consent ? 'yes' : 'no');

  // Formspree scores submissions on where they came from. A bare
  // server-to-server post (no Origin/Referer, non-browser UA) gets
  // accepted with a 200 and then quarantined as spam, so pass the
  // visitor's browser context through as if they had posted directly.
  const headers = { Accept: 'application/json' };
  for (const h of ['Origin', 'Referer', 'User-Agent', 'Accept-Language']) {
    const v = request.headers.get(h);
    if (v) headers[h] = v;
  }

  try {
    const res = await fetch(endpoint, { method: 'POST', body, headers });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.errors?.[0]?.message || `Formspree HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Formspree unreachable: ${err.message}` };
  }
}

/* ---------- Brevo ---------- */

async function addToBrevo(env, { name, email, phone }) {
  if (!env.BREVO_API_KEY) {
    console.warn('BREVO_API_KEY not set; skipping Brevo contact upsert.');
    return;
  }

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
  const res = await fetch(BREVO_CONTACTS_URL, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  // 201 = created, 204 = updated an existing contact (updateEnabled)
  if (res.ok) return { ok: true };

  const data = await res.json().catch(() => null);
  return { ok: false, error: data?.message || `Brevo HTTP ${res.status}` };
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

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}
