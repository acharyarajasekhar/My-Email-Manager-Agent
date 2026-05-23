# Email Manager - Architecture Overview

This document describes how the Email Manager works.

## System Flow

```
Gmail (new emails)
        ↓
index.js (fetch & summarize)
        ↓
Slack webhook (send summary + buttons)
        ↓
User clicks button in Slack
        ↓
server.js (receives action)
        ↓
Gmail API (delete/mark-read)
        ↓
Slack (confirm action)
```

## Core Components

### 1. **index.js** - Email Scheduler & Processor
- Runs every 3 hours (configurable)
- Fetches new unread emails from Gmail
- Generates summaries (strips sensitive data)
- Sends to Slack via webhook
- Handles CLI commands (check-emails, delete)

### 2. **server.js** - Slack Webhook Handler
- Express server listening for button clicks from Slack
- Verifies Slack signature (security check)
- Executes actions (delete/mark-read) on Gmail
- Returns confirmation to Slack

### 3. **utils/summarizer.js** - Content Processor
- Summarizes email bodies for Slack
- Strips sensitive data (credit cards, SSNs, API keys)
- Two engines: natural (lightweight) or ollama (AI)

### 4. **.env** - Configuration
- Gmail OAuth2 credentials
- Slack webhook URL & signing secret
- Check interval & email settings

## Key Features

✅ **Automated**: Checks Gmail every 3 hours  
✅ **Secure**: Credentials in .env, tokens auto-refresh  
✅ **Sanitized**: Sensitive data automatically stripped  
✅ **Interactive**: Delete/mark-read buttons in Slack  
✅ **Recoverable**: Emails moved to trash, not permanently deleted  
✅ **Scalable**: Run locally, on GitHub Actions, or in cloud  

## Deployment Options

| Option | How to Use | Cost |
|--------|-----------|------|
| Local | `npm start` | Free |
| GitHub Actions | Push to GitHub, configure secrets | Free |
| Cloud (Heroku/Railway) | Deploy server.js | $5-10/month |

## Next Steps

1. Copy `.env.example` to `.env`
2. Fill in credentials
3. Run `npm run test:integration` to verify setup
4. Run `npm start` to begin checking emails
5. For buttons: Run `npm run server` in another terminal

See [README.md](../README.md) for detailed setup instructions.
