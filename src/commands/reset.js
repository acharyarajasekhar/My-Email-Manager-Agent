'use strict';

const { parseTimeframe } = require('../utils/timeParser');
const { RateLimiter } = require('../utils/rateLimiter');

const RESET_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Module-level singleton; can be overridden in tests via the exported setter.
let _rateLimiter = new RateLimiter();

/**
 * Handle a /email-reset Slack slash command.
 *
 * Moves the email checkpoint backwards so the next scheduled check will
 * re-process emails from that point forward.
 *
 * @param {object} opts
 * @param {string}       opts.text          - Raw command text (e.g. "24h", "7d", "2026-05-20")
 * @param {string}       [opts.userId]      - Slack user ID of requester
 * @param {string}       [opts.userName]    - Slack username of requester
 * @param {StateManager} opts.stateManager  - Account state manager
 * @param {number|null}  [opts.accountId]
 * @returns {object} Slack ephemeral response (Block Kit or plain text)
 */
async function handleReset({ text, userId, userName, stateManager, accountId = null }) {
  const timeframe = (text || '').trim();
  if (!timeframe) {
    return _errorResponse(
      'Please provide a timeframe. Examples: `24h`, `7d`, `2026-05-20`'
    );
  }

  // Rate limit: one reset per hour per account
  const key = `reset:account-${accountId ?? 'default'}`;
  const { allowed, remainingMs } = _rateLimiter.check(key, RESET_COOLDOWN_MS);
  if (!allowed) {
    const minutes = Math.ceil(remainingMs / 60_000);
    return _errorResponse(
      `Rate limit exceeded. You can reset once per hour. Try again in ${minutes} minute(s).`
    );
  }

  let newCheckpoint;
  try {
    newCheckpoint = parseTimeframe(timeframe);
  } catch (err) {
    // Release the rate-limit slot since this was a user error, not abuse
    _rateLimiter.clear(key);
    return _errorResponse(`Invalid timeframe — ${err.message}`);
  }

  const previousState = stateManager.load();
  const previousCheckpoint = previousState.lastCheckTime || 'never';

  stateManager.resetTo(newCheckpoint, {
    resetBy: userName || userId || 'slack-user',
    reason: `/email-reset ${timeframe}`,
  });

  return _successResponse({
    timeframe,
    previousCheckpoint,
    newCheckpoint: newCheckpoint.toISOString(),
    requestedBy: userName || userId || 'unknown',
  });
}

/**
 * Override the module-level RateLimiter instance (test helper).
 *
 * @param {RateLimiter} limiter
 */
function _setRateLimiter(limiter) {
  _rateLimiter = limiter;
}

// ─── Response builders ────────────────────────────────────────────────────────

function _successResponse({ timeframe, previousCheckpoint, newCheckpoint, requestedBy }) {
  return {
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '✅ Email Checkpoint Reset' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Previous checkpoint:*\n${_fmtDate(previousCheckpoint)}` },
          { type: 'mrkdwn', text: `*New checkpoint:*\n${_fmtDate(newCheckpoint)}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `The next check will process emails received *after* the new checkpoint.\nTimeframe: *${timeframe}* | Requested by: ${requestedBy}`,
        },
      },
    ],
  };
}

function _errorResponse(message) {
  return { response_type: 'ephemeral', text: `❌ ${message}` };
}

function _fmtDate(iso) {
  try { return require('../utils/timezone').formatDate(iso); } catch { return String(iso); }
}

module.exports = { handleReset, _setRateLimiter };
