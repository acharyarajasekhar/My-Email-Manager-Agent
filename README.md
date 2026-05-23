# Email Manager Agent for Node.js

Automated email management: monitors Gmail, sends summaries to Slack, handles deletions via buttons.

**🚀 Want automated checks 24/7 without your laptop?** → Deploy to [GitHub Actions](docs/GITHUB_SETUP.md) (free)

## Features

✅ Monitors Gmail for new unread emails every 3 hours  
✅ Sends sanitized email summaries to Slack  
✅ Interactive buttons to delete/mark-read emails  
✅ Automatically strips sensitive data (credit cards, SSNs, API keys)  
✅ GitHub Actions ready for 24/7 automation (free)  
✅ Optional AI-powered summarization with Ollama  

## Prerequisites

- **Node.js** 16+ ([download](https://nodejs.org/))
- **Gmail API credentials** (OAuth2) from [Google Cloud Console](https://console.cloud.google.com/)
- **Slack webhook URL** from [Slack API](https://api.slack.com/apps)
- Gmail access & refresh tokens

## Quick Start

### 1. Clone & Install

```bash
git clone <repository>
cd My-Email-Manager-Agent
npm install
```

### 2. Setup Credentials

```bash
cp .env.example .env
```

Edit `.env` with your:
- Gmail Client ID & Secret (from Google Cloud Console)
- Gmail access & refresh tokens (from OAuth Playground)
- Slack webhook URL (from Slack API)

📖 **Detailed setup**: See [README setup section](#setup) below

### 3. Test Configuration

```bash
npm run test:integration
```

If it passes, you're ready! ✅

### 4. Start Checking Emails

```bash
# Check emails once
npm run check-emails

# Or start scheduler (checks every 3 hours)
npm start

# For interactive buttons, run in another terminal:
npm run server
```

---

## Setup Details

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Get Gmail API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project → Enable Gmail API
3. Create OAuth2 credentials (Desktop app)
4. Download credentials JSON
5. Extract `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` to `.env`

### Step 3: Generate Gmail Tokens

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Settings (gear) → Enable "Use your own OAuth credentials"
3. Step 1: Enter your Client ID & Secret
4. Step 2: Select Gmail API → `gmail.modify` scope
5. Step 3: Authorize & exchange code for tokens
6. Copy `GMAIL_ACCESS_TOKEN` and `GMAIL_REFRESH_TOKEN` to `.env`

### Step 4: Create Slack Webhook

1. Go to [Slack Apps](https://api.slack.com/apps)
2. Create new app → From scratch
3. Name: "Email Manager"
4. Left sidebar → "Incoming Webhooks" → Activate
5. Add webhook for your channel
6. Copy webhook URL to `.env` as `SLACK_WEBHOOK_URL`

### Step 5: Verify Setup

```bash
npm run test:integration
```

---

## Usage

| Command | What It Does |
|---------|-------------|
| `npm start` | Start scheduler (checks every 3 hours) |
| `npm run check-emails` | Check emails once |
| `npm run server` | Start webhook server (for Slack buttons) |
| `npm run dev` | Development mode (auto-reload) |
| `npm run test:gmail` | Test Gmail connection |
| `npm run test:slack` | Test Slack webhook |
| `npm run test:integration` | Test complete pipeline |
| `npm run batch:cleanup` | Intelligently delete/archive emails |

### Slack Integration

**Email Summaries include:**
- Sender address
- Subject line
- Preview (200 chars, sanitized)
- Delete & Mark-Read buttons

Click buttons in Slack to perform actions directly on Gmail.

### For Interactive Buttons

You need both scheduler and server running:

```bash
# Terminal 1
npm start

# Terminal 2
npm run server
```

For **local testing**, use [ngrok](https://ngrok.com/) to expose server:
```bash
ngrok http 3000
# Update .env: SERVER_WEBHOOK_URL=<ngrok-url>/slack/actions
```

---

## Configuration

All settings in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GMAIL_CLIENT_ID` | - | Gmail API Client ID |
| `GMAIL_CLIENT_SECRET` | - | Gmail API Client Secret |
| `GMAIL_ACCESS_TOKEN` | - | Gmail OAuth2 Access Token |
| `GMAIL_REFRESH_TOKEN` | - | Gmail OAuth2 Refresh Token |
| `SLACK_WEBHOOK_URL` | - | Slack incoming webhook URL |
| `SLACK_SIGNING_SECRET` | - | Slack signing secret (for button verification) |
| `EMAIL_CHECK_INTERVAL` | `10800000` | Check interval in ms (3 hours) |
| `SUMMARIZER_ENGINE` | `natural` | `natural` (fast) or `ollama` (AI) |
| `ENABLE_INTERACTIVE_BUTTONS` | `true` | Show delete/read buttons |
| `SERVER_WEBHOOK_URL` | `http://localhost:3000/slack/actions` | Where Slack sends button clicks |
| `PORT` | `3000` | Server port |

See [.env.example](.env.example) for detailed descriptions.

---

## Deployment

### Local / Always-On Server

```bash
npm start
```

### GitHub Actions (Free 24/7 Automation)

Automatically checks Gmail every 3 hours without your laptop:

1. Push code to GitHub
2. Go to repo Settings → Secrets → add:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_ACCESS_TOKEN`
   - `GMAIL_REFRESH_TOKEN`
   - `SLACK_WEBHOOK_URL`
   - `SLACK_SIGNING_SECRET`
3. Done! Actions run automatically

📖 [Full GitHub Actions setup](docs/GITHUB_SETUP.md)

**Multi-Account Setup:** Running for multiple Gmail accounts? → [Matrix Strategy Guide](docs/MULTI_ACCOUNT_SETUP.md)

### Cloud Services (Heroku, Railway, AWS, etc.)

Deploy `server.js` for persistent webhook handling:

- **Railway.app**: Connect GitHub, auto-deploy, free tier
- **Render**: Simple deployment, $7/month
- **Heroku**: $7/month (paid plans only now)
- **AWS Lambda**: ~$1/month with API Gateway

For interactive buttons, you need a deployed endpoint.

---

## Interactive Buttons

### Local Testing

Use ngrok to expose your local server:

```bash
ngrok http 3000
# Update .env: SERVER_WEBHOOK_URL=<ngrok-url>/slack/actions
```

### Production

Deploy to cloud service and update Slack Request URL to your endpoint.

📖 [Full button setup guide](docs/SLACK_INTERACTIVE_SETUP.md)

---

## Security

⚠️ **Critical:**
- **Never commit `.env`** (already in `.gitignore`)
- **Never share webhook URLs** in public channels
- **Rotate tokens** if exposed
- **Use HTTPS** in production

### What Gets Stripped

Automatically removed from email summaries:
- Credit card numbers
- Social Security numbers
- API keys & passwords
- Sensitive patterns

### Token Management

- Access tokens auto-refresh every hour
- Refresh tokens stored in `.env` (long-lived)
- If exposed, revoke immediately via Google Account settings

📖 [Full security guide](SECURITY.md)

---

## Architecture

- **index.js**: Scheduler & email processor
- **server.js**: Slack webhook handler  
- **utils/summarizer.js**: Content processor & sanitizer
- **.env**: Configuration (credentials, intervals)

📖 [Architecture details](docs/email-manager.agent.md)

---

## Testing

| Command | Purpose |
|---------|---------|
| `npm run test:gmail` | Test Gmail API connection |
| `npm run test:slack` | Test Slack webhook |
| `npm run test:integration` | Full end-to-end test |
| `npm run batch:cleanup` | Test batch operations |

Run these before production deployment.

---

## Troubleshooting

### Gmail Issues
- **"Invalid credentials"**: Check `.env`, tokens may be expired
- **"No emails found"**: Verify unread emails exist in inbox
- **"Rate limit exceeded"**: Increase `EMAIL_CHECK_INTERVAL`

### Slack Issues
- **"Webhook failed"**: Verify webhook URL in `.env`
- **"Buttons don't work"**: Is `npm run server` running?
- **"Connection refused"**: Check firewall/network settings

### Development
- **"Port 3000 in use"**: `PORT=3001 npm run server`
- **"Module not found"**: `rm -rf node_modules && npm install`

---

## License

MIT

---

## Support

- 📖 See [docs/](docs/) for detailed guides
  - [GitHub Actions Setup](docs/GITHUB_SETUP.md) - Automated 24/7 checks
  - [Multi-Account Setup](docs/MULTI_ACCOUNT_SETUP.md) - Run for multiple Gmail accounts
  - [Slack Interactive Buttons](docs/SLACK_INTERACTIVE_SETUP.md) - Delete/mark-read from Slack
  - [Intelligent Features](docs/INTELLIGENT_FEATURES.md) - Smart tracking, Slack commands, batch cleanup
- 🔒 Review [SECURITY.md](SECURITY.md) before production
- 🐛 Check logs: `npm run test:integration`
