# Security Policy

This document outlines security best practices for using and deploying the Email Manager Agent.

## Overview

The Email Manager Agent processes email data and integrates with Slack. Security is critical to protect:
- Gmail OAuth2 credentials (tokens, IDs, secrets)
- Slack webhook URLs
- Email content (may contain sensitive information)
- Your Gmail account access

## Credential Management

### ✅ Do's

- **Store credentials in `.env` file only** - Never hardcode API keys in source code
- **Add `.env` to `.gitignore`** - Prevent accidental commits (already configured)
- **Use `.env.example` as a template** - Share this with others, not actual `.env`
- **Rotate tokens regularly** - Regenerate Gmail tokens monthly if possible
- **Use minimal API scopes** - Only grant `Gmail.modify` permission to Gmail API
- **Keep `.env` on secure, encrypted systems** - Use full-disk encryption
- **Use environment variables in deployment** - GitHub Actions, Docker, etc. never store `.env`

### ❌ Don'ts

- **Never commit `.env` to git** - Even if deleted later, it remains in git history
- **Never share `.env` via email or chat** - Credentials can be intercepted
- **Never use production credentials in development** - Create separate OAuth apps if possible
- **Never log credentials** - Avoid printing tokens, secrets in console
- **Never expose credentials in error messages** - Sanitize error logs before sharing
- **Never store credentials in comments** - Code review tools will flag it

### If Credentials Are Leaked

1. **Revoke tokens immediately**:
   - Go to [Google Account Security Settings](https://myaccount.google.com/security)
   - Find connected apps and remove "Email Manager Agent"
   - Regenerate tokens via [Google OAuth Playground](https://developers.google.com/oauthplayground)

2. **Remove from git history**:
   ```bash
   # Remove .env from git history
   git filter-branch --tree-filter 'rm -f .env' HEAD
   git push --force-with-lease
   ```

3. **Rotate Slack webhook**:
   - Go to [Slack API Dashboard](https://api.slack.com/apps)
   - Find your Email Manager app
   - Delete old webhook and create new one

## Data Protection

### Sensitive Data Stripping

The agent automatically strips sensitive data from email content:

**Patterns Removed:**
- Credit card numbers (16-19 digits)
- Social Security numbers (XXX-XX-XXXX)
- API keys and tokens (patterns like `sk_*`, `pk_*`, etc.)
- Passwords (common password patterns)
- Phone numbers (10-digit patterns)

**Example:**
```
Input:  "Call me at 555-123-4567 or email me. My SSN is 123-45-6789"
Output: "Call me at [REDACTED] or email me. My SSN is [REDACTED]"
```

### Email Content Handling

- **Summaries sent to Slack** - Full email bodies are summarized; only summaries appear in Slack
- **No attachments processed** - File attachments are ignored, never sent to Slack
- **Content is temporary** - Email content is not stored; only last check time is saved
- **Slack message retention** - Configure Slack retention policies per your security needs

## Network Security

### Slack Webhook URL Protection

- **Treat webhook URLs as secrets** - They can send messages to your Slack channel
- **Webhook URLs should not be logged** - Already sanitized in server.js
- **Rotate webhooks periodically** - Delete and recreate via Slack API
- **Restrict channel access** - Use private channels for email notifications
- **Use unique webhooks per deployment** - Production and staging should have separate webhooks

### HTTPS in Production

- **Always use HTTPS** - Never expose webhooks over HTTP in production
- **Use valid SSL certificates** - Self-signed certificates are not production-ready
- **Verify SSL on ngrok URLs** - Free ngrok tunnels use HTTPS automatically
- **For persistent deployments** - Use services like:
  - AWS Lambda + API Gateway
  - Heroku
  - Digital Ocean App Platform
  - GitHub Actions (for scheduled checks only, not webhooks)

### Input Validation

The agent validates all inputs before processing:

- **Email ID validation** - Must be alphanumeric (base64url format)
- **Action validation** - Must match expected patterns (delete_gmail_*, read_gmail_*, etc.)
- **Slack payload validation** - Must contain valid action structure
- **No SQL injection** - Gmail API doesn't use SQL, but validation prevents abuse

## Google OAuth2 Security

### Token Lifetime

- **Access tokens** - Valid for ~1 hour, automatically refreshed
- **Refresh tokens** - Valid indefinitely (revoked on credential change or account security event)
- **Token storage** - Store in `.env`, never commit to git

### Scope Limitation

The agent uses minimal scopes:

```
gmail.modify
- Allows: Read emails, mark as read/unread, delete to trash
- Doesn't allow: Delete permanently, access calendar, access contacts
```

### Secure Token Refresh

- **Automatic refresh** - The `google-auth-library` handles token refresh transparently
- **No manual token refresh needed** - If token expires, the library requests a new one
- **Refresh token protection** - Never expose refresh token in logs or over HTTP

## Deployment Security

### Slack Request Signing

The agent verifies all webhook requests from Slack using HMAC-SHA256 signatures. This prevents request forgery attacks.

**Setup:**
1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Select your Email Manager app
3. Go to "Basic Information"
4. Copy the "Signing Secret"
5. Add to `.env`:
   ```
   SLACK_SIGNING_SECRET=your_signing_secret_here
   ```

**How it works:**
- Slack includes `X-Slack-Request-Timestamp` and `X-Slack-Signature` headers
- The agent computes expected signature using signing secret + timestamp + request body
- Requests with invalid signatures are rejected with HTTP 401
- Timestamps older than 5 minutes are rejected (prevents replay attacks)

**If signing secret is not configured:**
- A warning is logged to console
- Request verification is skipped (⚠️ NOT RECOMMENDED for production)

### GitHub Actions

For GitHub Actions deployment, use Secrets:

```yaml
# .github/workflows/email-check.yml
env:
  GMAIL_CLIENT_ID: ${{ secrets.GMAIL_CLIENT_ID }}
  GMAIL_CLIENT_SECRET: ${{ secrets.GMAIL_CLIENT_SECRET }}
  GMAIL_ACCESS_TOKEN: ${{ secrets.GMAIL_ACCESS_TOKEN }}
  GMAIL_REFRESH_TOKEN: ${{ secrets.GMAIL_REFRESH_TOKEN }}
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

✅ **Benefits:**
- Secrets are encrypted at rest
- Secrets are masked in logs
- Secrets are never printed in GitHub Actions output

### Docker Deployment

```dockerfile
FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Pass environment variables at runtime
CMD ["npm", "start"]
```

Then run with:
```bash
docker run \
  -e GMAIL_CLIENT_ID=xxx \
  -e GMAIL_CLIENT_SECRET=xxx \
  -e GMAIL_ACCESS_TOKEN=xxx \
  -e GMAIL_REFRESH_TOKEN=xxx \
  -e SLACK_WEBHOOK_URL=xxx \
  email-manager-agent
```

### Environment-Specific Configuration

- **Development**: Use limited-scope test email accounts
- **Production**: Use dedicated Gmail and Slack apps
- **CI/CD**: Use GitHub Secrets or equivalent secret management

## Logging and Monitoring

### What NOT to Log

❌ API credentials (tokens, secrets, keys)  
❌ Full request/response bodies (contain sensitive data)  
❌ Gmail access tokens  
❌ Slack webhook URLs  
❌ Email content or subject lines in logs  

### What TO Log

✅ Operation status (success/failure)  
✅ Error messages (without sensitive data)  
✅ Retry attempts  
✅ Email check timestamps  
✅ Action IDs (without email IDs)  

### Example Safe Logging

```javascript
// ❌ DON'T DO THIS
console.log('Slack request:', JSON.stringify(req.body));
console.log('Webhook URL:', process.env.SLACK_WEBHOOK_URL);
console.log('Email:', email);

// ✅ DO THIS
console.log('Slack action received: delete_gmail');
console.log('Gmail fetch started, last check:', lastCheckTime);
console.log('Error deleting email:', error.message);
```

## Incident Response

### If Your Credentials Are Compromised

1. **Immediately revoke tokens** (see Credential Management section)
2. **Review Gmail account activity** - Check [Gmail Security Checkup](https://myaccount.google.com/security-checkup)
3. **Review GitHub Actions logs** - Check for unauthorized token usage
4. **Notify affected users** - If emails were sent to shared Slack channels
5. **Document the incident** - For compliance and prevention

### Suspected Data Breach

1. **Stop the agent** - Kill all running processes
2. **Audit recent emails** - Check which emails were processed
3. **Review Slack logs** - See what was posted to Slack
4. **Rotate all credentials** - New OAuth tokens, new Slack webhook
5. **Update deployment** - Restart with new credentials

## Third-Party Dependencies

### Dependencies Used

| Package | Purpose | Security Notes |
|---------|---------|-----------------|
| `googleapis` | Gmail API client | Official Google library, regularly updated |
| `express` | Web server | Popular framework, security patches available |
| `axios` | HTTP client | Used for Slack API calls, HTTPS-only |
| `dotenv` | Environment config | Loads .env, doesn't validate - you must |
| `ollama` | AI summarization | Optional, requires local Ollama server |

### Vulnerability Management

```bash
# Check for vulnerabilities
npm audit

# Fix automatic vulnerabilities
npm audit fix

# Review remaining vulnerabilities
npm audit report
```

## Compliance Considerations

### Data Protection

- **GDPR**: Email content is processed; ensure compliance with data processing agreements
- **HIPAA**: Do not use for health-related emails without proper BAA
- **PCI DSS**: Automatic credit card redaction helps, but verify adequacy
- **SOC 2**: Implement proper access controls and logging

### Recommendations

- Document where emails are processed (local, cloud, GitHub Actions, etc.)
- Implement audit logging for who accessed emails
- Regularly review and delete processed email history
- Keep data retention policies documented

## Security Checklist

Use this checklist before deploying to production:

- [ ] `.env` is in `.gitignore` and never committed
- [ ] `.env.example` has placeholder values only
- [ ] All credentials are strong and unique
- [ ] Gmail API has minimal scopes (gmail.modify only)
- [ ] Slack webhook is from a private channel
- [ ] HTTPS is enabled (not HTTP)
- [ ] Input validation is in place for all user inputs
- [ ] Sensitive data is not logged to console
- [ ] Retry logic doesn't retry authentication errors
- [ ] Error messages don't expose credentials
- [ ] GitHub Secrets are used for CI/CD deployments
- [ ] Token rotation schedule is documented
- [ ] Incident response plan is documented
- [ ] Dependencies are up-to-date (npm audit)
- [ ] SECURITY.md and security best practices are documented

## Questions or Security Issues?

If you discover a security vulnerability:

1. **Do not open a public issue** - Disclose privately
2. **Document the issue** - Description, steps to reproduce, impact
3. **Provide context** - Your environment, versions, configuration
4. **Wait for response** - Maintainers will work on a fix

## References

- [Google OAuth 2.0 Security Best Practices](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Security](https://developers.google.com/gmail/api/guides/limiting-scopes)
- [Slack API Security](https://api.slack.com/best-practices/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Checklist](https://nodejs.org/en/security/)
