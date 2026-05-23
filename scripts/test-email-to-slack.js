require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');
const { generateSummary, sanitizeContent } = require('../utils/summarizer');
const { loadConfig } = require('../src/config');

// Configuration
const SUMMARIZER_ENGINE = process.env.SUMMARIZER_ENGINE || 'natural';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Wrapper to call summarizer with current config
async function generateEmailSummary(content) {
  return generateSummary(content, SUMMARIZER_ENGINE, {
    model: OLLAMA_MODEL,
    baseUrl: OLLAMA_BASE_URL,
  });
}

// Initialize Gmail client
async function initGmailClient(cfg) {
  const auth = new google.auth.OAuth2(
    cfg.gmail.clientId,
    cfg.gmail.clientSecret,
    cfg.gmail.redirectUrl
  );

  auth.setCredentials({
    access_token:  cfg.gmail.accessToken,
    refresh_token: cfg.gmail.refreshToken,
  });

  return google.gmail({ version: 'v1', auth });
}

// Fetch last 5 emails
async function fetchLast5Emails(cfg) {
  try {
    const gmail = await initGmailClient(cfg);
    
    console.log('📥 Fetching last 1 email from Gmail...\n');

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 1,
      orderBy: 'internal_date',
    });

    if (!response.data.messages) {
      console.log('❌ No emails found');
      return [];
    }

    const emails = [];
    for (const message of response.data.messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full',
      });

      const headers = msg.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
      let snippet = msg.data.snippet || '';
      const summary = await generateEmailSummary(snippet);

      emails.push({
        id: message.id,
        from,
        subject,
        preview: summary,
        source: 'gmail',
      });
    }

    return emails;
  } catch (error) {
    console.error('❌ Error fetching emails:', error.message);
    return [];
  }
}

// Format single email for Slack
function formatEmailMessage(email) {
  const typeIcon = email.preview?.type === 'marketing' ? '📢' : '📌';
  
  let message = `📧 ${typeIcon} ${email.preview?.type === 'marketing' ? 'Marketing' : 'Email'}\n\n`;
  message += `*From:* ${email.from}\n`;
  message += `*Subject:* ${email.subject}\n\n`;
  
  // For marketing emails, show minimal content
  if (email.preview?.type === 'marketing') {
    message += `_${email.preview?.summary || 'Marketing/Promotional email'}_\n`;
  } else {
    message += `*Summary:*\n${email.preview?.summary || 'No summary'}\n\n`;
    message += `*Action:* ${email.preview?.action || 'Review'}\n`;
  }
  
  message += `\n_Updated ${new Date().toLocaleString()}_`;
  return message;
}

// Format email with interactive delete button (Block Kit)
function formatEmailMessageWithButtons(email) {
  const deleteActionId = `delete_gmail_${email.id}`;
  const clearActionId = `clear_gmail_${email.id}`;
  const typeIcon = email.preview?.type === 'marketing' ? '📢' : '📌';
  const isMarketing = email.preview?.type === 'marketing';
  
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📧 ${typeIcon} ${isMarketing ? 'Marketing' : 'Email'}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*From:*\n${email.from}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Subject:*\n${email.subject}`,
      },
    },
  ];

  // Different content for marketing vs normal emails
  if (isMarketing) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_${email.preview?.summary || 'Marketing/Promotional email'}_`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary:*\n${email.preview?.summary || 'No summary available'}`,
      },
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Action Required:*\n${email.preview?.action || 'Review the email'}`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Delete',
          emoji: true,
        },
        value: email.id,
        action_id: deleteActionId,
        confirm: {
          title: {
            type: 'plain_text',
            text: 'Delete Email?',
          },
          text: {
            type: 'mrkdwn',
            text: 'This will permanently delete the email from your inbox.',
          },
          confirm: {
            type: 'plain_text',
            text: 'Delete',
          },
          deny: {
            type: 'plain_text',
            text: 'Cancel',
          },
        },
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Clear',
          emoji: true,
        },
        value: email.id,
        action_id: clearActionId,
      },
    ],
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Updated ${new Date().toLocaleString()}_`,
      },
    ],
  });

  return { blocks };
}

// Format emails for Slack (deprecated)
function formatSlackMessage(emails) {
  let message = '📧 *Your Last 5 Emails*\n\n';

  if (emails.length === 0) {
    message += '✅ No emails found!\n';
    return message;
  }

  emails.forEach((email, index) => {
    message += `*${index + 1}. ${email.subject}*\n`;
    message += `From: ${email.from}\n`;
    message += `Preview: ${email.preview}\n\n`;
  });

  message += `_Generated at ${new Date().toLocaleString()}_`;
  return message;
}

// Send to Slack
async function sendToSlack(webhookUrl, message) {
  try {
    const payload = typeof message === 'string'
      ? { text: message }
      : { ...message, response_type: 'in_channel' };

    await axios.post(webhookUrl, payload);
    console.log('✅ Message sent to Slack!\n');
  } catch (error) {
    console.error('❌ Error sending to Slack:', error.message);
  }
}

// Main
async function main() {
  const accountId = parseInt(process.env.TEST_ACCOUNT_ID || '1', 10);
  const cfg = loadConfig(accountId);

  console.log(`🧪 Testing Email to Slack Integration (account ${accountId})\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const enableButtons = process.env.ENABLE_INTERACTIVE_BUTTONS !== 'false';
  if (enableButtons) {
    console.log('🔘 Interactive buttons ENABLED\n');
  }

  // Fetch emails
  const emails = await fetchLast5Emails(cfg);

  if (emails.length === 0) {
    console.log('❌ No emails to send\n');
    return;
  }

  console.log(`✅ Fetched ${emails.length} emails\n`);

  // Send individual messages for each email with instant error handling
  console.log('📤 Sending to Slack...\n');
  for (const email of emails) {
    try {
      const message = enableButtons 
        ? formatEmailMessageWithButtons(email)
        : formatEmailMessage(email);
      
      console.log(`📋 Message for: ${email.subject}\n`);
      if (typeof message === 'string') {
        console.log(message);
      } else {
        console.log('[Block Kit Format - Check Slack for rendered message]');
      }
      console.log('\n' + '═'.repeat(60) + '\n');
      await sendToSlack(cfg.slack.webhookUrl, message);
      // Small delay between messages
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Error sending email "${email.subject}" to Slack:`, error.message);
      const errorMsg = `⚠️ *Failed to send email to Slack*\n📧 *Subject:* ${email.subject}\n*Error:* ${error.message}`;
      await sendToSlack(cfg.slack.webhookUrl, errorMsg);
    }
  }
  
  console.log('✅ Integration test complete!\n');
}

main();

