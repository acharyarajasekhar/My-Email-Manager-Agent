'use strict';

/**
 * Retry an async function with exponential backoff.
 *
 * Does NOT retry on HTTP 400 / 401 / 403 — those are client-side errors
 * where retrying will not help.
 *
 * @param {function(): Promise<any>} fn
 * @param {number} [maxRetries=3]
 * @param {number} [initialDelayMs=1000]
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.status ?? error.response?.status;
      // Don't retry on permanent client errors
      if (status === 400 || status === 401 || status === 403) throw error;
      if (attempt < maxRetries - 1) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

module.exports = { retryWithBackoff };
