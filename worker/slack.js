'use strict';
// worker/slack.js — Slack signature verification + response helpers
// Uses only Web Crypto API (no Node.js built-ins) — compatible with CF Workers.

/**
 * Verify a Slack request signature using HMAC-SHA256 via Web Crypto API.
 * Performs a constant-time comparison to prevent timing attacks.
 *
 * @param {Request} request   - Incoming Cloudflare Request
 * @param {string}  rawBody   - Raw request body text (already read by caller)
 * @param {string}  secret    - SLACK_SIGNING_SECRET
 * @returns {Promise<boolean>}
 */
export async function verifySignature(request, rawBody, secret) {
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes (replay-attack prevention)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const mac  = await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${timestamp}:${rawBody}`));
  const computed = 'v0=' + [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  // Constant-time string comparison
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/**
 * Parse a Slack POST body.
 * - Interactive button payloads: URL-encoded with a `payload` JSON field
 * - Slash command bodies: plain URL-encoded form fields
 *
 * @param {string} rawBody
 * @returns {object}
 */
export function parseSlackBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  if (params.has('payload')) return JSON.parse(params.get('payload'));
  return Object.fromEntries(params.entries());
}

// ── Response factories ────────────────────────────────────────────────────────

export const jsonResp = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Ephemeral plain-text Slack response */
export const ackText = (msg) =>
  jsonResp({ response_type: 'ephemeral', text: msg });

/** Ephemeral Block Kit Slack response */
export const ackBlocks = (blocks) =>
  jsonResp({ response_type: 'ephemeral', blocks });

/** Replace the original Slack message (removes action buttons after click) */
export const replaceMessage = (text) =>
  jsonResp({ replace_original: true, text });
