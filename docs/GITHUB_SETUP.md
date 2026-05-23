# GitHub Actions Setup

Automate email checks 24/7 without your laptop (free).

## Quick Setup (5 minutes)

### 1. Push Code to GitHub

```bash
git init
git add .
git commit -m "Email manager agent"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/email-manager.git
git push -u origin main
```

### 2. Add Secrets

Go to GitHub: **Settings → Secrets and variables → Actions → New secret**

Add these 6 secrets:

| Secret | Where to Get |
|--------|-------------|
| `GMAIL_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/) → OAuth credentials |
| `GMAIL_CLIENT_SECRET` | Same as above |
| `GMAIL_ACCESS_TOKEN` | [OAuth Playground](https://developers.google.com/oauthplayground) |
| `GMAIL_REFRESH_TOKEN` | Same as above |
| `SLACK_WEBHOOK_URL` | [Slack API](https://api.slack.com/apps) → Incoming Webhooks |
| `SLACK_SIGNING_SECRET` | [Slack API](https://api.slack.com/apps) → Basic Information |

### 3. Done!

GitHub Actions automatically runs every 3 hours. Check **Actions** tab to see runs.

---

## How It Works

- Workflow file: `.github/workflows/email-check.yml`
- Runs on schedule: Every 3 hours (UTC)
- Checks Gmail for new emails
- Sends to Slack
- Auto-commits state file

---

## Customization

### Change Schedule

Edit `.github/workflows/email-check.yml`:

```yaml
# Current: Every 3 hours
cron: '0 0,3,6,9,12,15,18,21 * * *'

# To change:
cron: '0 */4 * * *'      # Every 4 hours
cron: '0 9 * * *'        # Daily at 9 AM UTC
cron: '0 */2 * * *'      # Every 2 hours
```

[Cron syntax help](https://crontab.guru/)

---

## Manual Trigger

Run immediately without waiting:

1. Go to **Actions** tab
2. Select "Email Check - Every 3 Hours"
3. Click **Run workflow**

---

## Monitor Runs

- **Actions tab**: See all workflow runs
- **Click a run**: View logs and any errors
- **Commits**: Auto-committed state files track when checks ran

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Workflow not running | Ensure secrets are set (case-sensitive) |
| "Permission denied" | Enable "Read and write permissions" in Actions settings |
| Emails not in Slack | Verify SLACK_WEBHOOK_URL secret is correct |
| Logs show errors | Click failed run to see detailed error messages |
| Tokens expired | Regenerate via OAuth Playground, update secrets |

---

## Costs

✅ **Free** — GitHub Actions includes free quota for public repos and private repos.

---

## Security Notes

- Secrets are **encrypted** and **never logged**
- Only you and maintainers can see logs
- Secrets not passed to untrusted actions
- Logs automatically redact secret values

---

## Next Steps

- Monitor first run in **Actions** tab
- Verify emails appear in Slack
- Adjust schedule if needed
- For interactive buttons, also deploy `server.js` to cloud service
