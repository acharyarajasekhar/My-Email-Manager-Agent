# Multi-Account GitHub Actions Setup

Run email checks for multiple Gmail accounts simultaneously using GitHub Actions Matrix strategy.

## Architecture Overview

```
Workflow Trigger (every 3 hours)
  ↓
Read accounts.json
  ↓
Matrix Strategy Loop:
  Account 1 (alice@gmail.com) → Process → Slack (#emails-alice)
  Account 2 (bob@gmail.com)   → Process → Slack (#emails-bob)
  Account 3 (charlie@gmail.com) → Process → Slack (#emails-charlie)
  ↓ (All parallel)
Commit state files (separate per account)
  ↓
Done ✅
```

---

## Implementation Plan

### Phase 1: Configuration

#### 1.1 Create `accounts.json`

File: `accounts.json` (root directory)

```json
{
  "accounts": [
    {
      "id": 1,
      "email": "alice@gmail.com",
      "slack_channel": "#emails-alice"
    },
    {
      "id": 2,
      "email": "bob@gmail.com",
      "slack_channel": "#emails-bob"
    },
    {
      "id": 3,
      "email": "charlie@gmail.com",
      "slack_channel": "#emails-charlie"
    }
  ]
}
```

**What it contains:**
- `id`: Unique identifier for the account (used for matrix iteration)
- `email`: Gmail address (for reference/logging)
- `slack_channel`: Target Slack channel for this account's emails

**How to add accounts:**
- Add new object to `accounts` array
- Increment `id` (should be sequential starting from 1)
- Provide email and channel
- No code changes needed

---

### Phase 2: GitHub Secrets Setup

For each account, create 6 secrets:

#### Account 1 Secrets:
```
ACCOUNT_1_GMAIL_CLIENT_ID
ACCOUNT_1_GMAIL_CLIENT_SECRET
ACCOUNT_1_GMAIL_ACCESS_TOKEN
ACCOUNT_1_GMAIL_REFRESH_TOKEN
ACCOUNT_1_SLACK_WEBHOOK_URL
ACCOUNT_1_SLACK_SIGNING_SECRET
```

#### Account 2 Secrets:
```
ACCOUNT_2_GMAIL_CLIENT_ID
ACCOUNT_2_GMAIL_CLIENT_SECRET
ACCOUNT_2_GMAIL_ACCESS_TOKEN
ACCOUNT_2_GMAIL_REFRESH_TOKEN
ACCOUNT_2_SLACK_WEBHOOK_URL
ACCOUNT_2_SLACK_SIGNING_SECRET
```

**Repeat for each account.**

### How to Add Secrets

1. Go to GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ACCOUNT_1_GMAIL_CLIENT_ID` (exact format)
4. Value: Your actual credential
5. Repeat for all 6 secrets per account

**Naming convention:** `ACCOUNT_{id}_{CREDENTIAL_TYPE}`
- Must be uppercase
- `{id}` matches the ID in `accounts.json`

---

### Phase 3: Workflow Modification

#### Current Workflow Structure

```yaml
# .github/workflows/email-check.yml
on:
  schedule:
    - cron: '0 0,3,6,9,12,15,18,21 * * *'

jobs:
  email-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run email check
        env:
          GMAIL_CLIENT_ID: ${{ secrets.GMAIL_CLIENT_ID }}
          # ... other credentials
        run: npm start
```

#### Modified Workflow with Matrix

```yaml
# .github/workflows/email-check.yml
on:
  schedule:
    - cron: '0 0,3,6,9,12,15,18,21 * * *'

jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v3
      - id: set-matrix
        run: |
          echo "matrix=$(cat accounts.json | jq '.accounts | map(.id)')" >> $GITHUB_OUTPUT

  email-check:
    needs: prepare
    runs-on: ubuntu-latest
    strategy:
      matrix:
        account: ${{ fromJson(needs.prepare.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      
      - name: Run email check for account ${{ matrix.account }}
        env:
          ACCOUNT_ID: ${{ matrix.account }}
          GMAIL_CLIENT_ID: ${{ secrets[format('ACCOUNT_{0}_GMAIL_CLIENT_ID', matrix.account)] }}
          GMAIL_CLIENT_SECRET: ${{ secrets[format('ACCOUNT_{0}_GMAIL_CLIENT_SECRET', matrix.account)] }}
          GMAIL_ACCESS_TOKEN: ${{ secrets[format('ACCOUNT_{0}_GMAIL_ACCESS_TOKEN', matrix.account)] }}
          GMAIL_REFRESH_TOKEN: ${{ secrets[format('ACCOUNT_{0}_GMAIL_REFRESH_TOKEN', matrix.account)] }}
          SLACK_WEBHOOK_URL: ${{ secrets[format('ACCOUNT_{0}_SLACK_WEBHOOK_URL', matrix.account)] }}
          SLACK_SIGNING_SECRET: ${{ secrets[format('ACCOUNT_{0}_SLACK_SIGNING_SECRET', matrix.account)] }}
        run: npm start
      
      - name: Commit state file for account ${{ matrix.account }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add ".last-email-check-account-${{ matrix.account }}.json"
          git commit -m "Update email check state for account ${{ matrix.account }}" || true
          git push
```

**Key concepts:**
- `needs: prepare` - First job reads `accounts.json`
- `strategy.matrix.account` - Creates job for each account ID
- `secrets[format(...)]` - Dynamically loads secrets by account ID
- `ACCOUNT_ID` env var - Passed to Node app to identify account

---

### Phase 4: Code Changes Required

#### 4.1 Update `index.js`

**Read Account ID from Environment:**

```javascript
const accountId = process.env.ACCOUNT_ID || '1';  // Default to account 1
const lastCheckFile = `.last-email-check-account-${accountId}.json`;
```

**Why:**
- Each account needs separate state file
- Prevents emails from one account from affecting another
- Allows independent scheduling per account

#### 4.2 Load Account Details (Optional)

```javascript
const fs = require('fs');
const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8'));
const currentAccount = accounts.accounts.find(a => a.id === parseInt(accountId));

console.log(`Processing account: ${currentAccount.email}`);
```

**Why:**
- Log which account is being processed
- Can customize behavior per account if needed
- Useful for debugging

#### 4.3 Update Slack Message

Add account identifier to email summaries:

```javascript
const message = {
  text: `📧 [${currentAccount.email}] New Email`,
  blocks: [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📧 ${currentAccount.email}`,
      }
    },
    // ... rest of message
  ]
};
```

**Why:**
- Users know which account the email is from
- Easier to filter/search in Slack

---

## Directory Structure

```
repo/
├── accounts.json                    # NEW: Account configuration
├── .github/
│   └── workflows/
│       └── email-check.yml          # MODIFIED: Matrix strategy
├── index.js                         # MODIFIED: Account ID handling
├── server.js
├── package.json
├── .env.example
├── .gitignore
│   ├── .last-email-check-account-1.json  # NEW
│   ├── .last-email-check-account-2.json  # NEW
│   └── .last-email-check-account-3.json  # NEW
└── ...
```

---

## State File Management

Each account maintains separate state:

```
.last-email-check-account-1.json
{
  "lastCheck": "2026-05-23T15:30:00Z",
  "account_id": 1
}

.last-email-check-account-2.json
{
  "lastCheck": "2026-05-23T15:30:00Z",
  "account_id": 2
}
```

**Why separate files:**
- Account 1's emails don't block Account 2
- Each account has independent timing
- One account can fail without affecting others
- Easy to reset individual account state

**Update `.gitignore`:**
```
.last-email-check-account-*.json
```

---

## GitHub Actions UI Result

After implementation, GitHub Actions dashboard shows:

```
Email Check - Every 3 Hours

✅ Prepare (reads accounts.json)
├─ ✅ Check Email Account 1 (alice@gmail.com) - 45s
├─ ✅ Check Email Account 2 (bob@gmail.com) - 42s
└─ ✅ Check Email Account 3 (charlie@gmail.com) - 40s
```

Each account appears as separate job entry.

---

## Slack Organization Options

### Option 1: Separate Channels (Recommended)

Each account posts to its own channel:

```
#emails-alice       → alice@gmail.com emails
#emails-bob         → bob@gmail.com emails
#emails-charlie     → charlie@gmail.com emails
```

**Advantages:**
- Clean separation
- Individual notification control per channel
- Easy permissions management

### Option 2: Threads in Single Channel

```
#email-summaries
├─ Thread: Account 1 (alice@gmail.com) emails
├─ Thread: Account 2 (bob@gmail.com) emails
└─ Thread: Account 3 (charlie@gmail.com) emails
```

**Advantages:**
- Centralized view
- All emails in one place
- Easier to cross-reference

### Option 3: Headers for Identification

```
#email-summaries

📧 [alice@gmail.com] From: sender1@example.com
Subject: ...

📧 [bob@gmail.com] From: sender2@example.com
Subject: ...
```

**Advantages:**
- Simple
- No channel/thread management
- All emails visible in timeline

---

## Scaling Considerations

### Adding New Account

1. Create 6 new GitHub Secrets (`ACCOUNT_N_*`)
2. Add entry to `accounts.json`
3. Push changes
4. Done! ✅

### Removing Account

1. Remove entry from `accounts.json`
2. Delete account's GitHub Secrets (optional)
3. Push changes
4. That account stops being processed

### Pausing Account

1. Temporarily comment out in `accounts.json`
2. Push changes
3. Reactivate by uncommenting

### Restarting Account

Delete state file to force full re-check:
- `.last-email-check-account-N.json`
- Push deletion
- Next workflow run will re-check from beginning

---

## Monitoring & Debugging

### View Individual Account Logs

1. GitHub → **Actions** tab
2. Click latest "Email Check" workflow
3. Expand job for specific account
4. See logs, errors, timing

### Test Single Account

Manually trigger with GitHub CLI:
```bash
gh workflow run email-check.yml
```

Or through GitHub UI:
1. Actions tab → Workflow name
2. "Run workflow" button

### Account-Specific Issues

If one account fails:
1. Check specific job logs
2. Verify secrets are correct (case-sensitive!)
3. Test locally with that account's credentials
4. Doesn't affect other accounts

---

## Cost & Performance

### GitHub Actions Free Quota

- **Public repos**: Unlimited
- **Private repos**: 2000 minutes/month free
- **Parallel jobs**: Up to 20 simultaneously

### Calculation Example (3 accounts)

```
Per run: 3 accounts × 2 min average = 6 min
Per day: 8 runs × 6 min = 48 min
Per month: 48 min × 30 days = 1440 min (well within 2000 min limit)
```

**With 10 accounts:**
```
Per run: 10 × 2 min = 20 min
Per month: 20 × 8 × 30 = 4800 min (exceeds 2000 limit)
```

**Solution:** Increase check interval to 6 hours for 10+ accounts.

---

## Future Enhancements

### Dynamic Account Discovery

Instead of static `accounts.json`, fetch from:
- Database
- Google Sheets API
- GitHub Gists
- REST API

### Per-Account Configuration

Allow overrides:
```json
{
  "accounts": [
    {
      "id": 1,
      "email": "alice@gmail.com",
      "slack_channel": "#emails-alice",
      "check_interval": "3h",
      "summarizer_engine": "ollama"
    }
  ]
}
```

### Account Status Dashboard

Track per-account metrics:
- Last check time
- Emails processed
- Success/failure rate
- Performance stats

---

## Implementation Checklist

- [ ] Create `accounts.json` with account list
- [ ] Add GitHub Secrets for each account (6 per account)
- [ ] Modify `.github/workflows/email-check.yml` with matrix strategy
- [ ] Update `index.js` to read `ACCOUNT_ID` and use separate state files
- [ ] Update Slack message to include account identifier
- [ ] Update `.gitignore` for state files: `.last-email-check-account-*.json`
- [ ] Test with first account
- [ ] Test with second account (if available)
- [ ] Verify GitHub Actions UI shows separate jobs
- [ ] Verify Slack messages are tagged correctly
- [ ] Document account onboarding process for team

---

## Troubleshooting

### "Secrets not found" Error

**Problem:** Workflow can't access `ACCOUNT_2_GMAIL_CLIENT_ID`

**Solution:**
1. Check secret name is **exactly** `ACCOUNT_2_GMAIL_CLIENT_ID` (case-sensitive)
2. Verify secret exists in Settings → Secrets
3. Wait 5 seconds after creating secret before triggering workflow

### Matrix Not Working

**Problem:** Only one account runs instead of all

**Solution:**
1. Check `accounts.json` is valid JSON (use [jsonlint.com](https://jsonlint.com/))
2. Verify `cat accounts.json | jq '.accounts | map(.id)'` returns `[1, 2, 3]`
3. Check `prepare` job output in GitHub Actions logs

### State Files Conflicting

**Problem:** Accounts interfering with each other

**Solution:**
1. Ensure separate state files: `.last-email-check-account-1.json`, etc.
2. Check `ACCOUNT_ID` env var is being set correctly
3. Verify `.gitignore` includes `*.json` state files

### One Account Fails, Others Continue?

**Expected behavior!** If Account 1 fails, Accounts 2 & 3 still run.

To force all to fail together (not recommended):
- Remove `continue-on-error: true` from workflow

---

## References

- [GitHub Actions Matrix](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs)
- [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [jq JSON processor](https://stedolan.github.io/jq/)

