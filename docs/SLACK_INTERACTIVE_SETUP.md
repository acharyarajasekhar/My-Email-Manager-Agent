# Interactive Buttons Setup Guide

Enable delete/mark-read buttons in Slack email summaries.

## Quick Start (Local Testing)

### 1. Expose Local Server

Use **ngrok** to make your local server publicly accessible to Slack:

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000
```

You'll get: `Forwarding https://xxxx-xxxx.ngrok.io -> http://localhost:3000`

### 2. Configure Slack

1. Go to [Slack Apps](https://api.slack.com/apps) → Your App
2. Click **Interactivity & Shortcuts**
3. Toggle **Interactivity** → **On**
4. Set **Request URL**:
   ```
   https://xxxx-xxxx.ngrok.io/slack/actions
   ```
   (Replace `xxxx-xxxx` with your ngrok URL)
5. Save

### 3. Enable in Email Manager

Update `.env`:
```env
ENABLE_INTERACTIVE_BUTTONS=true
SERVER_WEBHOOK_URL=https://xxxx-xxxx.ngrok.io/slack/actions
```

### 4. Start Server & Test

```bash
# Terminal 1: Start server
npm run server

# Terminal 2: Send test email to Slack
npm run test:integration

# Then click Delete/Read buttons in Slack
```

---

## Production Deployment

For persistent, always-on access (needed for GitHub Actions):

### Option 1: Cloud Service (Recommended)

Deploy `server.js` to one of these:

| Service | Cost | How |
|---------|------|-----|
| **Railway** | Free-$5/month | Push to GitHub, Railway deploys automatically |
| **Render** | Free tier | Connect GitHub repo, deploy web service |
| **Heroku** | $7/month (paid plans) | `heroku create`, `git push heroku` |
| **AWS Lambda** | ~$1/month | Deploy with API Gateway |

Example with Railway:
1. Push code to GitHub
2. Go to railway.app, connect your repo
3. Deploy automatically
4. Get public URL: `https://your-railway-app.up.railway.app`
5. Update Slack Request URL to: `https://your-railway-app.up.railway.app/slack/actions`

### Option 2: Self-Hosted Server

Run on your own server:
```bash
npm run server
```

Then update Slack Request URL to your server's public IP/domain.

### Option 3: GitHub Actions Only

If you only use GitHub Actions (no manual buttons):
- Don't configure interactive buttons
- Skip server.js setup
- GitHub Actions handles email checks automatically

---

## How It Works

1. Email Manager sends message to Slack with buttons
2. User clicks button in Slack
3. Slack sends request to your server
4. Server verifies Slack signature (security check)
5. Gmail API deletes or marks email
6. Slack confirms action

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Invalid Request URL" in Slack | ngrok not running, or URL doesn't match |
| "Connection refused" | Server not running (`npm run server`) |
| Buttons not appearing | `ENABLE_INTERACTIVE_BUTTONS=true` in .env |
| Action fails silently | Check server logs for errors |
| "Email already deleted" | Already deleted in Gmail |

## Testing Locally

```bash
npm run server                 # Start server
npm run test:integration       # Send email to Slack
# Click Delete/Read buttons in Slack to test
```

## Production Checklist

- [ ] Server deployed and accessible
- [ ] Slack Request URL updated to deployed server
- [ ] Delete/read buttons working in Slack
- [ ] HTTPS enabled (all cloud providers use HTTPS by default)
- [ ] Gmail tokens valid
- [ ] Slack signing secret verified
