require('dotenv').config();
const { google } = require('googleapis');
const { loadConfig } = require('../src/config');

async function testGmailConnectivity() {
  const accountId = parseInt(process.env.TEST_ACCOUNT_ID || '1', 10);

  try {
    console.log(`🧪 Testing Gmail Connectivity (account ${accountId})...\n`);

    const cfg = loadConfig(accountId);

    // Initialize Gmail client
    const auth = new google.auth.OAuth2(
      cfg.gmail.clientId,
      cfg.gmail.clientSecret,
      cfg.gmail.redirectUrl
    );

    auth.setCredentials({
      access_token:  cfg.gmail.accessToken,
      refresh_token: cfg.gmail.refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth });

    // Test 1: Get profile to verify authentication
    console.log('✓ Testing authentication...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`✅ Authentication successful!`);
    console.log(`📧 Email: ${profile.data.emailAddress}`);
    console.log(`📬 Total messages: ${profile.data.messagesTotal}\n`);

    // Test 2: Fetch latest email
    console.log('📥 Fetching latest email...');
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 1,
      orderBy: 'internal_date',
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('❌ No emails found in inbox\n');
      return;
    }

    const latestMessageId = response.data.messages[0].id;
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: latestMessageId,
      format: 'full',
    });

    const headers = message.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const date = headers.find(h => h.name === 'Date')?.value || 'Unknown';
    const snippet = message.data.snippet || '(No preview)';

    console.log('\n✅ Latest Email Details:');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📨 From: ${from}`);
    console.log(`📝 Subject: ${subject}`);
    console.log(`📅 Date: ${date}`);
    console.log(`📌 Message ID: ${latestMessageId}`);
    console.log(`\n📋 Preview:\n${snippet}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log('✅ Gmail connectivity test PASSED!\n');

  } catch (error) {
    console.error('\n❌ Gmail connectivity test FAILED!');
    console.error(`Error: ${error.message}\n`);
    
    if (error.message.includes('invalid_grant')) {
      console.log('💡 Tip: Your refresh token may be expired.');
      console.log('   Get a new authorization code and refresh token.\n');
    }
    
    if (error.message.includes('Invalid Credentials')) {
      console.log('💡 Tip: Check your credentials in .env file.\n');
    }
  }
}

// Run test
testGmailConnectivity();
