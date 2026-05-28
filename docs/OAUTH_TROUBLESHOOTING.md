# OAuth Token Troubleshooting Guide

## Common Gmail OAuth Errors & Fixes

---

## Error 1: Invalid Grant

**Symptoms:**
- "invalid_grant" error when fetching emails
- Authentication fails despite having credentials configured

**Root Causes:**
- Refresh token has expired (~6 months of inactivity)
- User changed their Google account password
- Multiple devices using same credentials simultaneously
- Token access was revoked from Google Account settings
- Clock skew (system time out of sync)

### How to Fix

1. **Regenerate your tokens via OAuth Playground:**
   - Go to: https://developers.google.com/oauthplayground

2. **Configure OAuth Playground with your credentials:**
   - Click ⚙️ (settings) 
   - Check "Use your own OAuth credentials"
   - Enter your `CLIENT_ID` and `CLIENT_SECRET`

3. **Select the correct Gmail scope:**
   - Search for: `Gmail API v1`
   - Select: `https://www.googleapis.com/auth/gmail.modify`

4. **Authorize and get new tokens:**
   - Click "Authorize APIs"
   - Complete Google sign-in
   - Exchange authorization code for tokens
   - Copy the new **Access Token** and **Refresh Token**

5. **Update your configuration:**
   ```
   ACCOUNT_X_GMAIL_ACCESS_TOKEN=<new-access-token>
   ACCOUNT_X_GMAIL_REFRESH_TOKEN=<new-refresh-token>
   ```

6. **Verify and restart:**
   - Ensure environment variables are loaded
   - Restart your application or service

---

## Error 2: Redirect URI Mismatch

**Symptoms:**
- "redirect_uri_mismatch" error during authorization
- Cannot authenticate with Google API

**Root Causes:**
- Redirect URI in code doesn't match Google Cloud Console registration
- Typo in redirect URI configuration
- Using different redirect URI than what's authorized

### How to Fix

#### Option A: Use OAuth Playground (Recommended)

1. **Allow OAuth Playground as a redirect URI:**
   - Go to: https://console.cloud.google.com/apis/credentials
   - Find and edit your OAuth 2.0 Client ID
   - Add to "Authorized redirect URIs":
     ```
     https://developers.google.com/oauthplayground
     ```
   - Save

2. **Generate tokens via OAuth Playground** (see "Invalid Grant" section above)

#### Option B: Desktop/CLI Flow

1. **Register desktop redirect URI:**
   - Go to: https://console.cloud.google.com/apis/credentials
   - Find and edit your OAuth 2.0 Client ID
   - Ensure "Authorized redirect URIs" contains:
     ```
     urn:ietf:wg:oauth:2.0:oob
     ```
   - Save

2. **Configure your application:**
   ```env
   ACCOUNT_X_GMAIL_REDIRECT_URL=urn:ietf:wg:oauth:2.0:oob
   ```

3. **Verify code default:**
   - Default redirect URL in code: `urn:ietf:wg:oauth:2.0:oob`
   - Should match what's registered in Google Cloud Console

---

## OAuth Scope Reference

### `gmail.modify` (Most Common)
- Read all emails
- Move emails to trash
- Mark emails as read/unread
- Recommended for full email management

### `gmail.readonly`
- Read-only access to emails
- Cannot modify or delete
- Use for audit/logging applications

### `gmail.labels`
- Manage custom labels only
- Limited use case

---

## Verification Checklist

Before troubleshooting, verify:

- [ ] Client ID and Client Secret are correct in Google Cloud Console
- [ ] Redirect URI matches exactly what's registered (no trailing slashes, exact protocol)
- [ ] Access Token and Refresh Token are set in environment
- [ ] System clock is correct (within ±5 minutes of actual time)
- [ ] Google account hasn't revoked app permissions
- [ ] Account hasn't changed password recently
- [ ] Using most recent tokens (not cached/old tokens)

---

## Debug Steps

### 1. Verify Environment Variables
```bash
# Check that credentials are loaded (should not be empty)
echo $ACCOUNT_X_GMAIL_CLIENT_ID
echo $ACCOUNT_X_GMAIL_CLIENT_SECRET
echo $ACCOUNT_X_GMAIL_ACCESS_TOKEN
echo $ACCOUNT_X_GMAIL_REFRESH_TOKEN
```

### 2. Check Token Expiration
- Access tokens expire in ~1 hour (auto-refresh via refresh token)
- Refresh tokens expire after ~6 months of inactivity
- If refresh token is old, regenerate both

### 3. Validate Credentials Format
- Client ID should be: `NUMBERS-XXX.apps.googleusercontent.com`
- Client Secret should be: `GOCSPX-XXX` (starts with GOCSPX)
- Access Token should be: `ya29.XXX`
- Refresh Token should be: `1//XXX` (starts with 1//)

### 4. Test Google API Connection
```bash
# Quick test to validate credentials (requires curl/bash)
curl -X GET \
  "https://www.googleapis.com/gmail/v1/users/me/profile" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Prevention

To avoid these errors in the future:

1. **Store refresh tokens securely** - Don't lose them
2. **Set calendar reminder** - Refresh tokens every 3-4 months
3. **Monitor token age** - Log when tokens are created
4. **Use version control carefully** - Never commit real tokens to git
5. **Automate token refresh** - Most libraries do this automatically
6. **Keep system time in sync** - Use NTP (Network Time Protocol)

---

## Resources

- [OAuth Playground](https://developers.google.com/oauthplayground)
- [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [OAuth 2.0 Scopes](https://developers.google.com/identity/protocols/oauth2/scopes)

---

## Notes

- These errors typically indicate credential/configuration issues, not code bugs
- Regenerating tokens resolves 90% of OAuth-related errors
- Always use HTTPS in production redirect URIs
- OAuth Playground access tokens expire quickly; use refresh tokens for long-lived access
