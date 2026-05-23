'use strict';

const { retryWithBackoff } = require('../../src/utils/retry');

// Replace the real setTimeout with a fake that resolves immediately
jest.useFakeTimers();

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.clearAllTimers();
  });

  it('returns result immediately when fn succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on second attempt', async () => {
    const transient = Object.assign(new Error('network error'), { status: 503 });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue('recovered');

    const resultPromise = retryWithBackoff(fn, 3, 10);
    // Advance fake timers to skip the backoff delay
    await Promise.resolve(); // allow microtask queue to flush first failure
    jest.runAllTimers();
    const result = await resultPromise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on HTTP 401 (auth error)', async () => {
    const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(authErr);

    await expect(retryWithBackoff(fn, 3, 0)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HTTP 403', async () => {
    const forbiddenErr = Object.assign(new Error('Forbidden'), { status: 403 });
    const fn = jest.fn().mockRejectedValue(forbiddenErr);

    await expect(retryWithBackoff(fn, 3, 0)).rejects.toMatchObject({ status: 403 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HTTP 400 (bad request)', async () => {
    const badReq = Object.assign(new Error('Bad Request'), { status: 400 });
    const fn = jest.fn().mockRejectedValue(badReq);

    await expect(retryWithBackoff(fn, 3, 0)).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('also reads status from error.response.status (axios-style)', async () => {
    const axiosErr = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    const fn = jest.fn().mockRejectedValue(axiosErr);

    await expect(retryWithBackoff(fn, 3, 0)).rejects.toMatchObject({ response: { status: 403 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting maxRetries', async () => {
    const transient = Object.assign(new Error('timeout'), { status: 504 });
    const fn = jest.fn().mockRejectedValue(transient);

    const resultPromise = retryWithBackoff(fn, 3, 1);
    // Advance all timers to skip all delays
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }

    await expect(resultPromise).rejects.toMatchObject({ message: 'timeout' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff: 1x, 2x delays', async () => {
    jest.useRealTimers();
    const delays = [];
    const originalSetTimeout = global.setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn, delay) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0); // resolve immediately
      });

    const transient = Object.assign(new Error('fail'), { status: 500 });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue('ok');

    await retryWithBackoff(fn, 3, 100);

    expect(delays[0]).toBe(100);   // initialDelayMs * 2^0
    expect(delays[1]).toBe(200);   // initialDelayMs * 2^1

    setTimeoutSpy.mockRestore();
    jest.useFakeTimers();
  });
});
