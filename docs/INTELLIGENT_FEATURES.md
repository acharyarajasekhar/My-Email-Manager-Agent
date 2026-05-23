# Intelligent Features Enhancement

Add smart timestamp tracking, Slack-based reset capability, and Slack-triggered batch cleanup with timeframe support.

## Overview

Transform the Email Manager from a simple time-based checker into an intelligent system that:
- ✅ Tracks exact email checkpoint timestamps (not time-based windows)
- ✅ Allows reset via Slack command (for reprocessing)
- ✅ Enables Slack-triggered cleanup with custom timeframes
- ✅ Provides real-time progress feedback in Slack
- ✅ Maintains audit trail of operations

---

## Enhancement 1: Smart Timestamp Tracking

### Problem with Current Approach

```
Current: Check every 3 hours for "unread emails"
Issues:
  ❌ Misses emails if check fails/is interrupted
  ❌ Doesn't track exact last-processed timestamp
  ❌ Depends on "unread" flag (fragile)
  ❌ Can't reliably resume from exact point
```

### New Approach: Persistent Checkpoint

```
Last check completed: 2026-05-23 12:00:00 UTC
↓
Next check: Fetch emails received AFTER 2026-05-23 12:00:00
↓
Process them
↓
Update checkpoint: 2026-05-23 15:00:00 UTC
```

### State File Format

**Before:**
```json
{
  "lastCheck": "2026-05-23T12:00:00Z"
}
```

**After (Enhanced):**
```json
{
  "lastCheckTime": "2026-05-23T12:00:00Z",
  "lastCheckTimestamp": 1716462000000,
  "account_id": 1,
  "email_count_last_check": 5,
  "emails_processed": 5,
  "status": "success",
  "next_scheduled_check": "2026-05-23T15:00:00Z"
}
```

### Gmail Query Change

**Before:**
```
Query: is:unread
Problem: Unreliable, depends on flag
```

**After:**
```
Query: after:2026/05/23  (where date = lastCheckTime from state)
Problem solved: ✅ Time-based, not flag-based
```

### Data Flow: Resilience

```
Scenario 1: Normal Operation

Run 1 (10:00):
  ├─ State file says: lastCheckTime = 09:00
  ├─ Query: after:2026/05/23 09:00
  ├─ Found 5 emails
  ├─ Process them
  └─ Update state: lastCheckTime = 10:00 ✅

Run 2 (13:00):
  ├─ State file says: lastCheckTime = 10:00
  ├─ Query: after:2026/05/23 10:00
  ├─ Found 3 new emails
  ├─ Process them
  └─ Update state: lastCheckTime = 13:00 ✅

Scenario 2: Process Crash

Run 2 (13:00) - FAILED mid-way:
  ├─ State file says: lastCheckTime = 10:00 (unchanged!)
  └─ Job crashes before updating state ❌

Run 3 (16:00) - Recovery:
  ├─ State file says: lastCheckTime = 10:00 (same!)
  ├─ Query: after:2026/05/23 10:00 (same query!)
  ├─ Found 3 emails (same 3 from failed Run 2)
  ├─ Process them
  └─ Update state: lastCheckTime = 16:00 ✅ NO DUPLICATES!
```

### Benefits

| Benefit | Impact |
|---------|--------|
| **Exact tracking** | Checkpoint to the second |
| **Resilient** | Survives crashes without duplicates |
| **Precise recovery** | Resume from exact point |
| **Multi-account safe** | Each account has independent state |
| **No dependencies** | Doesn't rely on email flags |

### Implementation Details

**Changes to index.js:**

1. Read state file: `lastCheckTime` instead of `lastCheck`
2. Build Gmail query with timestamp: `after:2026/05/23` 
3. Update state ONLY after successful processing
4. Store additional metadata (count, status, next_check)

**Changes to state file:**

- Use ISO format: `2026-05-23T12:00:00Z`
- Track Unix timestamp for reliability
- Include metadata for debugging
- Add `status` field (success/failed/partial)

---

## Enhancement 2: Slack-Based Reset Command

### Use Case

User wants to reprocess emails because:
- Check failed/was interrupted
- Testing cleanup rules
- Recovering from rate limit
- Adding new filters
- Manual recovery from error

### Solution: `/email-reset` Slash Command

```
User in Slack:  /email-reset 24h
Bot response:   ✅ Reset complete. Will check from 24 hours ago.

Next scheduled run will process emails from that time.
```

### Architecture

```
User sends: /email-reset 24h
      ↓
server.js receives webhook
      ↓
Verify Slack signature (security)
      ↓
Parse time parameter
      ↓
Calculate new checkpoint: now() - 24 hours
      ↓
Update .last-email-check.json
      ↓
Commit to git (track who reset, when)
      ↓
Return Slack confirmation
      ↓
Next scheduled check uses new checkpoint
```

### Slack Setup

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Your App → **Slash Commands**
3. Create New Command:
   - Command: `/email-reset`
   - Request URL: `https://your-deployed-server.com/slack/commands/reset`
   - Short Description: "Reset email checkpoint to reprocess emails"
   - Usage Hint: `[timeframe]` (e.g., 24h, 7d, custom-date)
4. Save

### Command Syntax

```bash
/email-reset 24h                    # Last 24 hours
/email-reset 7d                     # Last 7 days
/email-reset 30d                    # Last 30 days
/email-reset 2026-05-20             # Specific date
/email-reset 2026-05-20 14:30       # Specific date & time
```

### Implementation Details

**server.js changes:**

```javascript
POST /slack/commands/reset
  ├─ Extract time parameter from request
  ├─ Validate format (24h, 7d, date, etc.)
  ├─ Calculate new checkpoint timestamp
  ├─ Load current state file
  ├─ Update lastCheckTime
  ├─ Add metadata: resetBy, resetReason, timestamp
  ├─ Save state file
  ├─ Commit to git: "Reset checkpoint via Slack"
  ├─ Return success response
  └─ Post confirmation in Slack thread
```

### State File After Reset

```json
{
  "lastCheckTime": "2026-05-22T15:00:00Z",
  "lastCheckTimestamp": 1716375600000,
  "account_id": 1,
  "email_count_last_check": 5,
  "status": "reset",
  "resetBy": "alice@gmail.com",
  "resetReason": "Reprocess last 24 hours",
  "resetTimestamp": "2026-05-23T15:30:00Z",
  "next_scheduled_check": "2026-05-23T18:00:00Z"
}
```

### User Experience

```
User in Slack:
/email-reset 24h

Bot response (in thread):
✅ Email Checkpoint Reset Successfully!

Previous checkpoint: 2026-05-23 12:00 UTC
New checkpoint:      2026-05-22 15:00 UTC (24 hours ago)

What happens next:
• Next scheduled check will process emails from 2026-05-22 15:00 UTC
• All emails within that timeframe will be re-evaluated
• Cleanup rules, filters, and tagging will reapply
• Status: Ready ✅ (next check in ~1.5 hours)

⚠️ Note: Resetting will reprocess all emails in the timeframe.
Duplicates in Slack are unlikely due to internal deduplication.
```

### Safety Features

✅ **Validation:**
- Check timeframe is reasonable (min 1h, max 90 days)
- Prevent infinite loops
- Audit log of all resets

✅ **Confirmation:**
- Show old and new checkpoint
- Warn if too far back (many emails to process)
- Require explicit confirmation for >30 days

✅ **Rate limiting:**
- Allow 1 reset per hour (prevent abuse)
- Track resets in metadata
- Alert if too many resets

---

## Enhancement 3: Slack-Triggered Batch Cleanup

### Use Case

Instead of running `npm run batch:cleanup` locally, trigger from Slack:
- Schedule cleanup for specific timeframe
- See real-time progress
- Get detailed summary report
- Trigger from mobile/anywhere

### Solution: `/email-cleanup` Slash Command

```
User in Slack:  /email-cleanup 7d
Bot response:   🧹 Cleaning up emails from last 7 days... (in progress)
                [5 seconds later]
                📊 Cleanup complete!
                ✅ Deleted: 45 emails
                📦 Archived: 12 emails
                🚩 Flagged: 3 emails
```

### Architecture

```
User sends: /email-cleanup 7d
      ↓
server.js receives webhook
      ↓
Verify Slack signature
      ↓
Parse timeframe (7d, 24h, date range)
      ↓
Validate (not too large, not conflicting)
      ↓
Spawn async cleanup job
      ↓
Return immediate ack: "Cleanup starting... ⏳"
      ↓
Job runs in background:
  ├─ Fetch emails from timeframe
  ├─ Categorize (marketing, newsletters, bank, etc.)
  ├─ Apply cleanup rules
  ├─ Update progress in Slack thread every 10s
  ├─ Delete/archive/flag as appropriate
  └─ Send final summary
      ↓
User sees real-time updates in Slack
```

### Slack Setup

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Your App → **Slash Commands**
3. Create New Command:
   - Command: `/email-cleanup`
   - Request URL: `https://your-deployed-server.com/slack/commands/cleanup`
   - Short Description: "Batch cleanup emails by timeframe"
   - Usage Hint: `[timeframe]` (e.g., 7d, 24h, from-to dates)
4. Save

### Command Syntax

```bash
/email-cleanup 24h                                   # Last 24 hours
/email-cleanup 7d                                    # Last 7 days
/email-cleanup 30d                                   # Last 30 days
/email-cleanup 2026-05-15 2026-05-22                 # Date range
/email-cleanup from:2026-05-20                       # From specific date
/email-cleanup --categories marketing,newsletters    # Specific categories only
```

### Implementation Details

**server.js changes:**

```javascript
POST /slack/commands/cleanup
  ├─ Extract timeframe parameters
  ├─ Validate format & range
  ├─ Spawn async job: batch-cleanup-emails.js
  ├─ Return immediate ack to Slack
  ├─ Background job:
  │   ├─ Fetch emails in timeframe
  │   ├─ Categorize them
  │   ├─ Apply rules (delete/archive/flag)
  │   ├─ Update Slack thread with progress
  │   └─ Send final summary
  └─ Done
```

**batch-cleanup-emails.js changes:**

Add parameters:
```bash
node scripts/batch-cleanup-emails.js \
  --slack-thread-id "1716462000.123456" \
  --from 2026-05-16 \
  --to 2026-05-23 \
  --max-emails 500
```

Support timeframe parsing:
- `7d` → Last 7 days
- `24h` → Last 24 hours
- `2026-05-15 2026-05-22` → Date range
- `from:2026-05-20` → From date to now

### User Experience

**Initial Request:**
```
User: /email-cleanup 7d

Bot (immediate): 
🧹 Starting batch cleanup for last 7 days...
Timeframe: 2026-05-16 → 2026-05-23
Max emails: 500
Status: Initializing... ⏳
```

**Progress Updates (every 10 seconds):**
```
🧹 Batch Cleanup In Progress

Fetched: 120 emails ✓
Categorizing: 45% complete...
(Processing takes ~30 seconds for 60 emails)
```

**Final Summary:**
```
📊 Cleanup Complete! ✅

Timeframe: 2026-05-16 → 2026-05-23 (7 days)
Total emails processed: 60

✅ Deleted: 45 emails
  • Marketing: 25
  • Promotions: 15
  • Newsletters: 5

📦 Archived: 12 emails
  • Bank statements: 8
  • Receipts: 4

🚩 Flagged: 3 emails (manual review needed)
  • Insurance: 2
  • Event tickets: 1

⏱️ Processing time: 35 seconds
📧 Space freed: ~2.3 MB

💡 Tip: Run cleanup weekly to keep inbox organized!
Next cleanup available in 24 hours (cooldown).
```

### Email Categories & Rules

| Category | Rule | Action |
|----------|------|--------|
| Marketing | Contains: promo, discount, offer | Delete |
| Promotions | From: noreply@*.com, marketing terms | Delete |
| Newsletters | Unsubscribe link present | Delete |
| Social Media | From: twitter, facebook, linkedin, etc. | Delete |
| Bank Alerts | From: bank@*.com | Archive after 7 days |
| Receipts | From: orders@, invoice@, receipt@ | Archive after 30 days |
| Insurance | From: insurance@, policy@ | Flag for review |
| Event Tickets | From: ticketing@, eventbrite@ | Flag for review |
| OTP/Codes | Contains: verification, code, token | Delete after 1 hour |
| Account Updates | From: accounts@, support@ | Archive after 14 days |

### Safety Features

✅ **Constraints:**
- Max 500 emails per cleanup (prevent overload)
- Cooldown: 1 cleanup per 24 hours
- Preview mode: Show what would be deleted before confirming
- Dry-run option: `--dry-run` shows changes without applying

✅ **Audit Trail:**
- Log all cleanup operations
- Track: who, when, what, how many
- Recoverable: emails in trash for 30 days

✅ **Error Handling:**
- If job fails mid-way, resume from checkpoint
- Partial success: report what was completed
- No data loss: all in trash (recoverable)

✅ **Rate Limiting:**
- 1 cleanup per account per 24 hours
- Prevent abuse
- Skip if another cleanup in progress

---

## Configuration

Add to `.env.example`:

```bash
################################################################################
# INTELLIGENT FEATURES
################################################################################

# Smart timestamp tracking (new approach)
USE_SMART_TIMESTAMP=true
TIMESTAMP_STATE_FILE=.last-email-check.json

# Slack commands (reset & cleanup)
ENABLE_SLACK_COMMANDS=true

# Command cooldowns & safety
SLACK_COMMAND_COOLDOWN=3600              # Seconds between commands (1 hour)
MAX_EMAILS_PER_CLEANUP=500               # Safety limit
CLEANUP_PREVIEW_ENABLED=true             # Show what will be deleted

# Cleanup categories
CLEANUP_CATEGORIES_ENABLED=marketing,newsletters,promotions,social,bank,receipts,insurance,tickets,otp,accounts

# Gmail query improvements
USE_TIME_BASED_QUERY=true                # Use after: query instead of is:unread
SAFE_RESUME_ON_FAILURE=true              # Resume from exact checkpoint if crashed
```

---

## Implementation Phases

### Phase 1: Smart Timestamp Tracking ⭐ Start Here
**Effort:** Low | **Value:** High | **Time:** 2-3 hours

- [ ] Update state file format (add lastCheckTime, metadata)
- [ ] Modify Gmail query to use `after:date`
- [ ] Update index.js to read/write new format
- [ ] Test: Verify no email duplicates across runs
- [ ] Test: Crash recovery (interrupt process, resume)
- [ ] Handle edge cases (first run, very old date)

**Validation:**
- Run check 3 times, verify counts match
- Simulate crash, verify recovery works
- Check state file has all metadata

### Phase 2: Slack Reset Command
**Effort:** Medium | **Value:** Medium | **Time:** 4-5 hours

- [ ] Setup `/email-reset` slash command in Slack
- [ ] Implement server.js endpoint: `/slack/commands/reset`
- [ ] Parse timeframe parameters (24h, 7d, date, etc.)
- [ ] Validate time ranges (min 1h, max 90d)
- [ ] Update state file with reset metadata
- [ ] Commit to git with audit info
- [ ] Return confirmation to Slack
- [ ] Add rate limiting (1 reset per hour)

**Validation:**
- Test all timeframe formats
- Verify state file updates correctly
- Check git commits have metadata
- Confirm Slack response is clear

### Phase 3: Slack Cleanup Command
**Effort:** High | **Value:** High | **Time:** 6-8 hours

- [ ] Setup `/email-cleanup` slash command in Slack
- [ ] Implement server.js endpoint: `/slack/commands/cleanup`
- [ ] Parse timeframe parameters
- [ ] Enhance batch-cleanup-emails.js with timeframe support
- [ ] Add async job processing with progress updates
- [ ] Update Slack thread with real-time progress
- [ ] Generate detailed summary report
- [ ] Add cooldown between cleanups (24h)
- [ ] Implement dry-run mode (preview)

**Validation:**
- Test all timeframe formats
- Verify progress updates in Slack every 10s
- Check final report accuracy
- Ensure cooldown works
- Test error handling (partial failure)

### Phase 4: Rate Limiting & Safety ⭐ Important
**Effort:** Medium | **Value:** High | **Time:** 3-4 hours

- [ ] Add cooldown tracking for commands
- [ ] Prevent abuse (max attempts)
- [ ] Add preview confirmation for large cleanups
- [ ] Implement audit log
- [ ] Add rollback capability
- [ ] Safety warnings (e.g., "This will delete 200+ emails")
- [ ] Admin-only option (if desired)
- [ ] Error recovery mechanisms

**Validation:**
- Test cooldown prevents duplicate commands
- Verify audit log captures all operations
- Check preview shows correct counts

---

## Directory Structure

```
repo/
├── index.js                              # Modified: Use smart timestamps
├── server.js                             # Enhanced: Add Slack commands
├── scripts/
│   ├── batch-cleanup-emails.js          # Enhanced: Timeframe support
│   └── reset-checkpoint.js               # NEW: Manual reset utility
├── .last-email-check.json                # Enhanced format
├── .env.example                          # Updated: New config options
├── .gitignore                            # Updated: Ignore state files
└── docs/
    └── INTELLIGENT_FEATURES.md           # This file
```

---

## Slack Permissions Required

Add to Slack App manifest:

```yaml
scopes:
  - commands                    # Register slash commands
  - chat:write                  # Post messages
  - chat:write.public           # Post in channels
  - users:read                  # Get user info
  - users:read.email            # Get user email
```

---

## Testing Strategy

### Unit Tests
```
test/timestamp-utils.js
  ├─ Parse timeframe (24h, 7d, dates)
  ├─ Calculate checkpoint
  ├─ Validate formats
  └─ Handle edge cases

test/cleanup-categories.js
  ├─ Categorize emails correctly
  ├─ Apply rules accurately
  └─ Count deletions
```

### Integration Tests
```
test/integration.js
  ├─ Full reset → check → cleanup flow
  ├─ State file updates correctly
  ├─ Slack messages format correctly
  ├─ No duplicate emails after crash
  └─ Cooldown prevents abuse
```

### E2E Tests
```
Scenario 1: Normal flow
  ├─ Check emails (new checkpoint set)
  ├─ Reset via Slack (checkpoint moves back)
  ├─ Check emails (reprocess from old time)
  └─ Verify no duplicates

Scenario 2: Cleanup flow
  ├─ Trigger cleanup via Slack
  ├─ Watch progress in Slack thread
  ├─ Verify deletions in Gmail
  └─ Check final report

Scenario 3: Safety
  ├─ Cleanup in progress + another cleanup = blocked
  ├─ Reset twice rapidly = second blocked (cooldown)
  ├─ Large timeframe = preview + confirmation
  └─ Crash during cleanup = resume correctly
```

---

## Rollout Plan

### Week 1: Development & Testing
- Implement Phase 1 (timestamp tracking)
- Internal testing with team
- Fix bugs, edge cases

### Week 2: Staging
- Deploy to staging environment
- Test with real Gmail/Slack accounts
- Performance testing (100+ emails)

### Week 3: Production
- Deploy to production
- Monitor logs for issues
- Gradual rollout (start with 1-2 accounts)

### Week 4: Optimization
- Gather user feedback
- Optimize performance
- Implement Phase 2 (reset command)
- Implement Phase 3 (cleanup command)

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **No duplicates** | 0% | Check state file after crashes |
| **Checkpoint accuracy** | 100% | Verify timestamp matches last email |
| **Command reliability** | 99.5% | Monitor failed commands |
| **Cleanup accuracy** | 98%+ | Sample verification of deletions |
| **User adoption** | 80%+ | Track command usage in Slack |

---

## Future Enhancements

### Phase 5: Machine Learning
- Learn user cleanup patterns
- Auto-suggest cleanup rules
- Adaptive categorization

### Phase 6: Analytics Dashboard
- Email volume trends
- Cleanup history
- Storage savings
- Time savings

### Phase 7: Advanced Filtering
- Custom rules via Slack
- Conditional cleanup (if from + subject contains)
- Scheduled cleanups (weekly, monthly)

### Phase 8: Cross-Account Operations
- Cleanup across multiple accounts
- Consolidated reports
- Bulk resets

---

## Troubleshooting Guide

### Issue: "Timestamp reset not working"
**Solution:**
1. Verify state file has `lastCheckTime` field
2. Check timestamp format (ISO 8601)
3. Confirm git commit succeeded
4. Check server logs for errors

### Issue: "Cleanup missing emails"
**Solution:**
1. Verify timeframe is correct
2. Check category rules are enabled
3. Confirm email count matches fetch
4. Check Gmail query isn't filtered

### Issue: "Slack command not responding"
**Solution:**
1. Verify command URL is correct in Slack app settings
2. Check server is running and accessible
3. Confirm Slack signing secret matches
4. Check server logs for errors

### Issue: "Duplicates appearing in Slack"
**Solution:**
1. Verify timestamp tracking is working
2. Check state file updates after each run
3. Ensure crash recovery works
4. Monitor for concurrent runs

---

## References

- [Gmail API Query Syntax](https://developers.google.com/gmail/api/guides/filtering)
- [Slack Slash Commands](https://api.slack.com/interactivity/slash-commands)
- [Unix Timestamp Reference](https://www.unixtimestamped.com/)

