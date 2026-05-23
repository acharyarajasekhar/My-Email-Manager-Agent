require('dotenv').config();
const axios = require('axios');
const { loadConfig } = require('../src/config');

async function testSlackConnectivity() {
  const accountId = parseInt(process.env.TEST_ACCOUNT_ID || '1', 10);

  try {
    console.log(`🧪 Testing Slack Webhook Connectivity (account ${accountId})...\n`);

    const cfg = loadConfig(accountId);

    if (!cfg.slack.webhookUrl) {
      console.error(`❌ ACCOUNT_${accountId}_SLACK_WEBHOOK_URL not found in .env\n`);
      return;
    }

    console.log('✓ Testing Slack webhook...');

    const message = {
      text: '✅ *Email Manager* successfully connected to Slack!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *Email Manager Agent*\nSuccessfully connected to Slack webhook!',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: '*Status:*\n✅ Connected',
            },
            {
              type: 'mrkdwn',
              text: '*Time:*\n' + new Date().toLocaleString(),
            },
          ],
        },
      ],
    };

    const response = await axios.post(cfg.slack.webhookUrl, message);

    if (response.status === 200) {
      console.log('✅ Slack webhook test PASSED!\n');
      console.log('📬 Test message sent to your Slack channel.\n');
    }

  } catch (error) {
    console.error('\n❌ Slack webhook test FAILED!');
    console.error(`Error: ${error.message}\n`);
    
    if (error.response?.status === 404) {
      console.log('💡 Tip: Webhook URL is invalid or expired.');
      console.log('   Generate a new webhook URL from Slack.\n');
    }
    
    if (error.message.includes('ENOTFOUND')) {
      console.log('💡 Tip: Check your internet connection.\n');
    }
  }
}

// Run test
testSlackConnectivity();
