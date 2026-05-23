// worker/gmail.js — Gmail REST API client using native fetch + Web Crypto.
// No googleapis SDK — fully compatible with Cloudflare Workers runtime.

const GMAIL_API   = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';

// ── Token management ──────────────────────────────────────────────────────────

/**
 * Return a valid access token for the given account, refreshing if expired.
 * Tokens are cached in Cloudflare KV to avoid unnecessary refresh round-trips.
 *
 * @param {object} env      - CF Worker env bindings (secrets)
 * @param {object} kv       - CF KV namespace binding (env.EMAIL_KV)
 * @param {string} prefix   - e.g. "ACCOUNT_1_" for account 1 (required)
 * @returns {Promise<string>} Valid access token
 */
export async function getAccessToken(env, kv, prefix) {
  if (!prefix) throw new Error('prefix is required for getAccessToken');
  const cacheKey = `token:${prefix}`;

  // Return cached token if it won't expire in the next 60 s
  const cached = await kv.get(cacheKey, 'json').catch(() => null);
  if (cached?.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const clientId     = env[`${prefix}GMAIL_CLIENT_ID`];
  const clientSecret = env[`${prefix}GMAIL_CLIENT_SECRET`];
  const refreshToken = env[`${prefix}GMAIL_REFRESH_TOKEN`];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing Gmail credentials (prefix: "${prefix || 'default'}")`);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const { access_token, expires_in = 3600 } = await res.json();

  // Cache — expires 60 s before actual expiry to avoid edge-case staleness
  await kv.put(
    cacheKey,
    JSON.stringify({ accessToken: access_token, expiresAt: Date.now() + expires_in * 1000 }),
    { expirationTtl: Math.max(expires_in - 60, 30) }
  ).catch(() => {}); // Best-effort; don't fail if KV write fails

  return access_token;
}

/**
 * Invalidate a cached token (call after receiving a 401 from Gmail).
 */
export async function invalidateToken(kv, prefix) {
  if (!prefix) return;
  await kv.delete(`token:${prefix}`).catch(() => {});
}

// ── Message listing + fetching ────────────────────────────────────────────────

/**
 * List message IDs in INBOX received after a Unix timestamp.
 *
 * @param {string} token
 * @param {number} sinceUnix  - Unix timestamp (seconds)
 * @param {number} maxResults
 * @returns {Promise<Array<{id: string}>>}
 */
export async function listMessages(token, sinceUnix, maxResults = 50) {
  const url = `${GMAIL_API}/messages?q=${encodeURIComponent(`after:${sinceUnix} in:inbox`)}&maxResults=${maxResults}`;
  const data = await _get(token, url);
  return data.messages ?? [];
}

/**
 * Fetch message metadata (From, Subject, Date) and snippet.
 *
 * @param {string} token
 * @param {string} id   - Gmail message ID
 * @returns {Promise<{id, from, subject, timestamp, snippet}>}
 */
export async function getMessage(token, id) {
  // format=metadata returns headers + snippet; much lighter than format=full
  const qs = [
    'format=metadata',
    'metadataHeaders=From',
    'metadataHeaders=Subject',
    'metadataHeaders=Date',
    'fields=id,snippet,payload(headers)',
  ].join('&');
  const data = await _get(token, `${GMAIL_API}/messages/${id}?${qs}`);
  return _parseMessage(data);
}

// ── Message modification ──────────────────────────────────────────────────────

/**
 * Apply Gmail label changes to a message.
 *
 * @param {string}   token
 * @param {string}   id
 * @param {string[]} addLabels
 * @param {string[]} removeLabels
 */
export async function modifyMessage(token, id, addLabels = [], removeLabels = []) {
  const res = await fetch(`${GMAIL_API}/messages/${id}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err  = new Error(`Gmail modify failed (${res.status}): ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Convenience wrappers
export const deleteEmail  = (token, id) => modifyMessage(token, id, ['TRASH'],  ['INBOX']);
export const markAsRead   = (token, id) => modifyMessage(token, id, [],          ['UNREAD']);
export const archiveEmail = (token, id) => modifyMessage(token, id, [],          ['INBOX']);

// ── Private helpers ───────────────────────────────────────────────────────────

async function _get(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    const err  = new Error(`Gmail API error (${res.status}): ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function _parseMessage({ id, snippet = '', payload = {} }) {
  const headers = payload.headers ?? [];
  const get = (name) =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  return {
    id,
    from:      get('From'),
    subject:   get('Subject') || '(No Subject)',
    timestamp: new Date(get('Date')).getTime() || Date.now(),
    snippet:   snippet.slice(0, 300),
  };
}
