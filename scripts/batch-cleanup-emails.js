require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { Ollama } = require('ollama');

// Configuration
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REDIRECT_URL = process.env.GMAIL_REDIRECT_URL;
const GMAIL_ACCESS_TOKEN = process.env.GMAIL_ACCESS_TOKEN;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

const ollama = new Ollama({ baseUrl: OLLAMA_BASE_URL });

const SENSITIVE_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /bearer\s+\S+/gi,
];

const EMAIL_CATEGORIES = {
  MARKETING: 'marketing',
  INVESTMENT: 'investment',
  BANK: 'bank',
  NEWSLETTER: 'newsletter',
  SOCIAL: 'social',
  PROMOTION: 'promotion',
  OTP: 'otp',
  ACCOUNT_ALERT: 'account_alert',
  ACCOUNT_MANAGEMENT: 'account_management',
  INSURANCE: 'insurance',
  TICKETS: 'tickets',
  TICKET_MANAGEMENT: 'ticket_management',
  NORMAL: 'normal',
};

// Sensitive keywords for categorization
const CATEGORY_KEYWORDS = {
  [EMAIL_CATEGORIES.MARKETING]: ['sale', 'offer', 'discount', 'promotion', 'deal', 'limited time', 'buy now', 'shop', 'store'],
  [EMAIL_CATEGORIES.INVESTMENT]: ['portfolio', 'investment', 'dividend', 'mutual fund', 'stock', 'trading', 'broker', 'shares'],
  [EMAIL_CATEGORIES.BANK]: ['transaction', 'deposit', 'withdrawal', 'balance', 'statement', 'account', 'debit', 'credit', 'payment'],
  [EMAIL_CATEGORIES.NEWSLETTER]: ['newsletter', 'subscribe', 'unsubscribe', 'weekly digest', 'monthly report'],
  [EMAIL_CATEGORIES.SOCIAL]: ['facebook', 'twitter', 'linkedin', 'instagram', 'mention', 'connection', 'follow'],
  [EMAIL_CATEGORIES.OTP]: ['otp', 'one-time password', 'verification code', 'confirm identity', '2fa', 'two-factor'],
  [EMAIL_CATEGORIES.ACCOUNT_MANAGEMENT]: ['account update', 'profile update', 'account settings', 'subscription', 'account information', 'user preferences', 'account preferences', 'update account'],
  [EMAIL_CATEGORIES.ACCOUNT_ALERT]: ['account alert', 'suspicious activity', 'unauthorized access', 'account security', 'verify account', 'confirm account'],
  [EMAIL_CATEGORIES.INSURANCE]: ['insurance', 'policy', 'claim', 'premium', 'coverage', 'deductible', 'beneficiary'],
  [EMAIL_CATEGORIES.TICKETS]: ['ticket', 'event', 'concert', 'movie', 'sports', 'show', 'conference', 'ticket confirmation'],
  [EMAIL_CATEGORIES.TICKET_MANAGEMENT]: ['ticket', 'booking', 'reservation', 'confirmation', 'order status', 'tracking'],
};

let newCategoriesFound = new Set();
const BATCH_SIZE = 10;
// Single categories to auto-delete immediately (no time filter)
const AUTO_DELETE_CATEGORIES = [EMAIL_CATEGORIES.MARKETING, EMAIL_CATEGORIES.PROMOTION, EMAIL_CATEGORIES.NEWSLETTER, EMAIL_CATEGORIES.SOCIAL];
// Single categories to archive after N days
const ARCHIVE_CATEGORIES = [EMAIL_CATEGORIES.INVESTMENT, EMAIL_CATEGORIES.BANK, EMAIL_CATEGORIES.ACCOUNT_ALERT, EMAIL_CATEGORIES.ACCOUNT_MANAGEMENT];
// Categories to keep (manual review)
const MANUAL_REVIEW_CATEGORIES = [EMAIL_CATEGORIES.INSURANCE, EMAIL_CATEGORIES.TICKETS, EMAIL_CATEGORIES.TICKET_MANAGEMENT];
const ARCHIVE_AFTER_DAYS = 7;
const OTP_DELETE_AFTER_HOURS = 1;

// Check if category (possibly compound) should be auto-deleted
function shouldAutoDelete(category) {
  // Direct match
  if (AUTO_DELETE_CATEGORIES.includes(category)) return true;
  
  // Compound category check: split by pipe and check if ANY matches
  if (category.includes('|')) {
    const parts = category.split('|').map(p => p.trim());
    return parts.some(part => AUTO_DELETE_CATEGORIES.includes(part));
  }
  
  return false;
}

// Check if category (possibly compound) should be archived
function shouldArchive(category) {
  // Direct match
  if (ARCHIVE_CATEGORIES.includes(category)) return true;
  
  // Compound category check: split by pipe and check if ANY matches
  if (category.includes('|')) {
    const parts = category.split('|').map(p => p.trim());
    return parts.some(part => ARCHIVE_CATEGORIES.includes(part));
  }
  
  return false;
}

// Check if category should be manually reviewed
function isManualReview(category) {
  // Direct match
  if (MANUAL_REVIEW_CATEGORIES.includes(category)) return true;
  
  // Compound category check: if ANY part is manual review AND no auto-delete/archive parts
  if (category.includes('|')) {
    const parts = category.split('|').map(p => p.trim());
    const hasManual = parts.some(part => MANUAL_REVIEW_CATEGORIES.includes(part));
    const hasAutoDelete = parts.some(part => AUTO_DELETE_CATEGORIES.includes(part));
    const hasArchive = parts.some(part => ARCHIVE_CATEGORIES.includes(part));
    
    // Only manual review if it has manual parts and no higher-priority actions
    return hasManual && !hasAutoDelete && !hasArchive;
  }
  
  return false;
}

function sanitizeContent(content) {
  let sanitized = content;
  SENSITIVE_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  return sanitized;
}

// Categorize email using Ollama
async function categorizeEmail(subject, content, from) {
  try {
    const prompt = `Categorize this email into ONE category. Choose from:
SINGLE: marketing, investment, bank, newsletter, social, promotion, otp, account_alert, account_management, insurance, tickets, ticket_management, normal
COMPOUND: Any combination of single categories separated by pipes (e.g., investment|bank, marketing|investment, etc.)

Subject: ${subject}
From: ${from}
Content preview: ${content.substring(0, 200)}

RESPONSE FORMAT (JSON):
{
  "category": "single_category or category|category|...",
  "confidence": 0.0-1.0,
  "reason": "brief reason for categorization"
}

Respond ONLY with valid JSON.`;

    const response = await ollama.generate({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
    });

    const responseText = response.response.trim();
    
    try {
      const parsed = JSON.parse(responseText);
      return {
        category: parsed.category || EMAIL_CATEGORIES.NORMAL,
        confidence: parsed.confidence || 0.5,
        reason: parsed.reason || 'Unknown',
      };
    } catch (e) {
      return {
        category: EMAIL_CATEGORIES.NORMAL,
        confidence: 0.3,
        reason: 'Failed to parse Ollama response',
      };
    }
  } catch (error) {
    console.log('⚠️ Categorization failed:', error.message);
    return {
      category: EMAIL_CATEGORIES.NORMAL,
      confidence: 0,
      reason: 'Error during categorization',
    };
  }
}

// Initialize Gmail client
async function initGmailClient() {
  const auth = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URL
  );

  auth.setCredentials({
    access_token: GMAIL_ACCESS_TOKEN,
    refresh_token: GMAIL_REFRESH_TOKEN,
  });

  return google.gmail({ version: 'v1', auth });
}

// Get email age in days
function getEmailAgeDays(internalDate) {
  const emailTime = new Date(parseInt(internalDate));
  const now = new Date();
  const diffMs = now - emailTime;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.floor(diffDays);
}

// Get email age in hours
function getEmailAgeHours(internalDate) {
  const emailTime = new Date(parseInt(internalDate));
  const now = new Date();
  const diffMs = now - emailTime;
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.floor(diffHours);
}

// Format email received datetime
function getEmailReceivedDateTime(internalDate) {
  try {
    // Handle various formats: timestamp string, number, or Date object
    let emailTime;
    
    if (!internalDate) {
      return 'Unknown';
    }
    
    if (typeof internalDate === 'number') {
      emailTime = new Date(internalDate);
    } else if (typeof internalDate === 'string') {
      // Try parsing as number first, then as ISO string
      const parsed = parseInt(internalDate, 10);
      emailTime = isNaN(parsed) ? new Date(internalDate) : new Date(parsed);
    } else if (internalDate instanceof Date) {
      emailTime = internalDate;
    } else {
      return 'Unknown';
    }
    
    // Validate the date
    if (isNaN(emailTime.getTime())) {
      return 'Unknown';
    }
    
    return emailTime.toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (error) {
    console.error(`⚠️ Error formatting date: ${error.message}`);
    return 'Unknown';
  }
}

// Get full email content
async function getEmailContent(gmail, emailId) {
  try {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full',
    });

    const headers = message.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(Unknown)';
    
    let body = '';
    if (message.data.payload.parts) {
      const textPart = message.data.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart && textPart.body.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    } else if (message.data.payload.body && message.data.payload.body.data) {
      body = Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8');
    }

    return {
      id: emailId,
      subject,
      from,
      body: sanitizeContent(body),
      internalDate: message.data.internalDate,
      threadId: message.data.threadId,
    };
  } catch (error) {
    console.error('Error fetching email:', error.message);
    return null;
  }
}

// Fetch all emails in batches
async function fetchAllEmails(gmail, maxResults = 100) {
  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults: maxResults,
    });

    return response.data.messages || [];
  } catch (error) {
    console.error('Error fetching emails:', error.message);
    return [];
  }
}

// Send Slack notification
async function notifySlack(message) {
  try {
    await axios.post(SLACK_WEBHOOK_URL, {
      text: message,
    });
  } catch (error) {
    console.error('Failed to send Slack notification:', error.message);
  }
}

// Delete email
async function deleteEmail(gmail, emailId, subject = '') {
  try {
    // Use modify to properly move to trash: remove INBOX, add TRASH label
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        removeLabelIds: ['INBOX'],
        addLabelIds: ['TRASH'],
      },
    });
    console.log(`✅ Successfully moved to trash: ${subject}`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting email "${subject}":`, error.message);
    const errorMsg = `❌ *Failed to delete email*\n*Subject:* ${subject}\n*Error:* ${error.message}`;
    await notifySlack(errorMsg);
    return false;
  }
}

// Main batch cleanup function
async function batchCleanupEmails(maxCount = null) {
  console.log('\n🧹 Batch Email Cleanup Started\n');
  console.log('═'.repeat(60));

  try {
    const gmail = await initGmailClient();
    
    // Fetch all emails (use maxCount if provided, otherwise fetch up to 500)
    const fetchLimit = maxCount || 500;
    console.log(`📥 Fetching emails (max: ${fetchLimit})...`);
    const allEmails = await fetchAllEmails(gmail, fetchLimit);
    
    if (allEmails.length === 0) {
      console.log('✅ No emails to process');
      return;
    }

    console.log(`📊 Found ${allEmails.length} emails to process\n`);

    let processed = 0;
    let deleted = 0;
    let archived = 0;
    const stats = new Map();  // Dynamic stats tracking for any category

    // Process in batches
    for (let i = 0; i < allEmails.length; i += BATCH_SIZE) {
      const batch = allEmails.slice(i, i + BATCH_SIZE);
      
      console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allEmails.length / BATCH_SIZE)}`);

      for (const email of batch) {
        try {
          const fullEmail = await getEmailContent(gmail, email.id);
          if (!fullEmail) continue;

          const ageDays = getEmailAgeDays(fullEmail.internalDate);
          const categorization = await categorizeEmail(fullEmail.subject, fullEmail.body, fullEmail.from);
          const category = categorization.category;

          stats.set(category, (stats.get(category) || 0) + 1);

          // Track and notify about new categories immediately
          if (!Object.values(EMAIL_CATEGORIES).includes(category)) {
            newCategoriesFound.add(category);
            const newCatNotification = `🆕 *New Email Category Identified*\n\nCategory: *${category}*\n📧 *From:* ${fullEmail.from}\n*Subject:* ${fullEmail.subject}\n\nPlease review and decide how to handle this new category by updating cleanup rules.`;
            await notifySlack(newCatNotification);
          }

          let shouldDelete = false;
          let reason = '';

          // Rule: Delete OTP emails >= 1 hour old
          if (category === EMAIL_CATEGORIES.OTP && getEmailAgeHours(fullEmail.internalDate) >= OTP_DELETE_AFTER_HOURS) {
            shouldDelete = true;
            const ageHours = getEmailAgeHours(fullEmail.internalDate);
            reason = `🔐 Auto-deleted OTP email (${ageHours} hours old)`;
          }
          // Rule: Auto-delete if ANY part matches auto-delete categories (no time filter - delete immediately)
          else if (shouldAutoDelete(category)) {
            shouldDelete = true;
            reason = `📢 Auto-deleted ${category} email`;
          }
          // Rule: Archive if ANY part matches archive categories AND >= 7 days old
          else if (shouldArchive(category) && ageDays >= ARCHIVE_AFTER_DAYS) {
            shouldDelete = true;
            reason = `🗑️ Auto-archived old ${category} email (${ageDays} days old)`;
          }
          // Rule: Keep manual review categories (insurance/tickets/ticket_management)
          else if (isManualReview(category)) {
            const receivedTime = getEmailReceivedDateTime(fullEmail.internalDate);
            console.log(`👤 Review manual: ${fullEmail.subject} (${category}) [Received: ${receivedTime}]`);
          }

          if (shouldDelete) {
            const deleted_result = await deleteEmail(gmail, email.id, fullEmail.subject);
            if (deleted_result) {
              deleted++;
              const notification = `${reason}\n\n📧 *From:* ${fullEmail.from}\n*Subject:* ${fullEmail.subject}\n*Age:* ${ageDays} days`;
              await notifySlack(notification);
              const receivedTime = getEmailReceivedDateTime(fullEmail.internalDate);
              console.log(`✅ Deleted: ${fullEmail.subject} (${category}) [Received: ${receivedTime}]`);
            }
          } else if (category === EMAIL_CATEGORIES.NORMAL && ageDays > 30) {
            // Keep normal emails, just track
            const receivedTime = getEmailReceivedDateTime(fullEmail.internalDate);
            console.log(`📌 Normal email: ${fullEmail.subject} (${ageDays} days old) [Received: ${receivedTime}]`);
          } else {
            const receivedTime = getEmailReceivedDateTime(fullEmail.internalDate);
            console.log(`📧 Kept: ${fullEmail.subject} (${category}) [Received: ${receivedTime}]`);
          }

          processed++;
        } catch (error) {
          console.error(`Error processing email: ${error.message}`);
        }
      }

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < allEmails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Send summary
    console.log('\n' + '═'.repeat(60));
    console.log('\n📊 Batch Cleanup Summary:');
    console.log(`  ✅ Processed: ${processed} emails`);
    console.log(`  🗑️ Deleted: ${deleted} emails`);
    console.log(`\n📈 Category Breakdown:`);
    
    // Sort and display stats
    const sortedStats = Array.from(stats.entries()).sort((a, b) => b[1] - a[1]);
    for (const [category, count] of sortedStats) {
      if (count > 0) {
        console.log(`  ${category}: ${count}`);
      }
    }
    console.log(`  Marketing|Investment|Bank: ${stats['marketing|investment|bank']}`);
    if (newCategoriesFound.size > 0) {
      console.log(`\n🆕 New Categories Found: ${Array.from(newCategoriesFound).join(', ')}`);
    }

    // Build summary message with top categories
    let categoryStatsMsg = '📈 Categories:';
    const topStats = sortedStats.slice(0, 10);  // Top 10 categories
    for (const [category, count] of topStats) {
      if (count > 0) {
        categoryStatsMsg += `\n• ${category}: ${count}`;
      }
    }
    if (sortedStats.length > 10) {
      categoryStatsMsg += `\n• ... and ${sortedStats.length - 10} more categories`;
    }

    const summaryMessage = `✅ *Batch Cleanup Complete*\n\n📊 Stats:\n• Processed: ${processed} emails\n• Deleted: ${deleted} emails\n\n${categoryStatsMsg}${newCategoriesFound.size > 0 ? `\n\n🆕 New Categories: ${Array.from(newCategoriesFound).join(', ')}` : ''}`;
    await notifySlack(summaryMessage);

  } catch (error) {
    console.error('❌ Batch cleanup failed:', error.message);
    await notifySlack(`❌ Batch cleanup failed: ${error.message}`);
  }
}

// Run if called directly
if (require.main === module) {
  // Parse command-line arguments for max count
  // Usage: node batch-cleanup-emails.js [maxCount]
  // Example: node batch-cleanup-emails.js 50
  const args = process.argv.slice(2);
  let maxCount = null;
  
  if (args.length > 0) {
    const parsedMax = parseInt(args[0], 10);
    if (!isNaN(parsedMax) && parsedMax > 0) {
      maxCount = parsedMax;
      console.log(`📌 Max count parameter: ${maxCount} emails`);
    }
  }
  
  batchCleanupEmails(maxCount).then(() => {
    console.log('\n✨ Done!\n');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { batchCleanupEmails };
