'use strict';

// Keys used across tests — cleared in afterEach to prevent cross-test pollution
const TEST_ENV_KEYS = [
  'SLACK_SIGNING_SECRET', 'EMAIL_CHECK_INTERVAL',
  'ACCOUNT_1_GMAIL_CLIENT_ID', 'ACCOUNT_1_GMAIL_CLIENT_SECRET', 'ACCOUNT_1_GMAIL_REDIRECT_URL',
  'ACCOUNT_1_GMAIL_ACCESS_TOKEN', 'ACCOUNT_1_GMAIL_REFRESH_TOKEN',
  'ACCOUNT_1_SLACK_WEBHOOK_URL',
  'ACCOUNT_2_GMAIL_CLIENT_ID', 'ACCOUNT_3_GMAIL_CLIENT_ID',
];

afterEach(() => {
  TEST_ENV_KEYS.forEach((k) => delete process.env[k]);
  jest.resetModules();
});

/**
 * Apply env vars and require a fresh copy of the config module.
 * The env vars remain set until afterEach cleans them up, so loadConfig()
 * called inside the test body will see the correct values.
 */
function loadFresh(env) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  jest.resetModules();
  return require('../../src/config');
}

describe('loadConfig()', () => {
  const BASE_ENV = {
    ACCOUNT_1_GMAIL_CLIENT_ID:     'acct1-client-id',
    ACCOUNT_1_GMAIL_CLIENT_SECRET: 'acct1-client-secret',
    ACCOUNT_1_GMAIL_ACCESS_TOKEN:  'acct1-access-token',
    ACCOUNT_1_GMAIL_REFRESH_TOKEN: 'acct1-refresh-token',
    ACCOUNT_1_SLACK_WEBHOOK_URL:   'https://hooks.slack.com/acct1',
    SLACK_SIGNING_SECRET:          'signing-secret',
  };

  it('throws when accountId is not provided', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    expect(() => loadConfig()).toThrow(/accountId is required/);
  });

  it('loads prefixed env vars for account 1', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    const { gmail, slack, app } = loadConfig(1);
    expect(gmail.clientId).toBe('acct1-client-id');
    expect(gmail.refreshToken).toBe('acct1-refresh-token');
    expect(slack.webhookUrl).toBe('https://hooks.slack.com/acct1');
    expect(app.accountId).toBe(1);
  });

  it('accepts accountId as a string (coerces to int)', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    expect(loadConfig('1').app.accountId).toBe(1);
  });

  it('generates per-account stateFile', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    expect(loadConfig(2).app.stateFile).toBe('.last-email-check-account-2.json');
  });

  it('uses default redirectUrl when not in env', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    expect(loadConfig(1).gmail.redirectUrl).toBe('urn:ietf:wg:oauth:2.0:oob');
  });

  it('applies custom check interval', () => {
    const { loadConfig } = loadFresh({ ...BASE_ENV, EMAIL_CHECK_INTERVAL: '7200000' });
    expect(loadConfig(1).app.checkInterval).toBe(7_200_000);
  });

  it('defaults checkInterval to 3 hours', () => {
    const { loadConfig } = loadFresh(BASE_ENV);
    expect(loadConfig(1).app.checkInterval).toBe(3 * 60 * 60 * 1000);
  });
});

describe('validateGmailCredentials()', () => {
  it('does not throw when all required fields are present', () => {
    jest.resetModules();
    const { validateGmailCredentials } = require('../../src/config');
    expect(() =>
      validateGmailCredentials({
        clientId: 'id',
        clientSecret: 'secret',
        accessToken: 'access',
        refreshToken: 'refresh',
      })
    ).not.toThrow();
  });

  it('throws listing all missing required fields', () => {
    jest.resetModules();
    const { validateGmailCredentials } = require('../../src/config');
    expect(() =>
      validateGmailCredentials({ clientId: 'id' }) // missing 3 fields
    ).toThrow(/clientSecret.*accessToken.*refreshToken|Missing Gmail/);
  });

  it('throws with MISSING_CREDENTIALS error code', () => {
    jest.resetModules();
    const { validateGmailCredentials } = require('../../src/config');
    try {
      validateGmailCredentials({});
    } catch (err) {
      expect(err.code).toBe('MISSING_CREDENTIALS');
    }
  });
});

describe('loadAccounts()', () => {
  it('throws when accounts.json is absent', () => {
    jest.resetModules();
    const fs = require('fs');
    const spy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (String(p).endsWith('accounts.json')) return false;
      return jest.requireActual('fs').existsSync(p);
    });
    jest.resetModules();
    const { loadAccounts } = require('../../src/config');
    expect(() => loadAccounts()).toThrow(/accounts.json not found/);
    spy.mockRestore();
  });

  it('merges ACCOUNT_N_EMAIL and ACCOUNT_N_SLACK_CHANNEL from env vars', () => {
    process.env.ACCOUNT_1_EMAIL = 'alice@example.com';
    process.env.ACCOUNT_1_SLACK_CHANNEL = '#emails-alice';

    jest.resetModules();
    const fs = require('fs');
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ accounts: [{ id: 1 }] })
    );
    jest.resetModules();
    // Re-require after mocking fs
    const fsReal = require('fs');
    jest.spyOn(fsReal, 'existsSync').mockReturnValue(true);
    jest.spyOn(fsReal, 'readFileSync').mockReturnValue(
      JSON.stringify({ accounts: [{ id: 1 }] })
    );
    const { loadAccounts } = require('../../src/config');
    const accounts = loadAccounts();

    expect(accounts[0].email).toBe('alice@example.com');
    expect(accounts[0].slack_channel).toBe('#emails-alice');
    expect(accounts[0].id).toBe(1);

    spy.mockRestore();
    delete process.env.ACCOUNT_1_EMAIL;
    delete process.env.ACCOUNT_1_SLACK_CHANNEL;
  });
});
