const { Ollama } = require('ollama');

// Simple sentence tokenizer (replaces natural library to avoid ESM compatibility issues)
function tokenizeToSentences(text) {
  // Split on periods, question marks, and exclamation marks followed by space
  // Also handle multiple punctuation marks
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());
}

// Sensitive patterns to strip from emails
const SENSITIVE_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /[A-Za-z0-9_-]*[Pp]assword[A-Za-z0-9_-]*\s*[:=]\s*[^\s]*/g, // Password patterns
  /[Aa]pi[_-]?[Kk]ey\s*[:=]\s*[^\s]*/g, // API key patterns
];

// Sanitize email content
function sanitizeContent(content) {
  let sanitized = content;
  SENSITIVE_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  return sanitized;
}

// Natural language processor for summarization
function generateNaturalSummary(content) {
  try {
    // Tokenize content into sentences
    const sentences = tokenizeToSentences(content);
    
    if (sentences.length === 0) {
      return {
        type: 'normal',
        summary: sanitizeContent(content) || '(No content)',
        action: 'Review',
      };
    }

    // Calculate sentence scores based on word frequency
    const allWords = content.toLowerCase().split(/\W+/);
    const wordFreq = {};
    
    allWords.forEach(word => {
      if (word.length > 3) { // Skip short words
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });

    // Score sentences by word frequency
    const sentenceScores = sentences.map((sentence, idx) => {
      const words = sentence.toLowerCase().split(/\W+/);
      const score = words.reduce((sum, word) => sum + (wordFreq[word] || 0), 0);
      return { sentence: sentence.trim(), score, index: idx };
    });

    // Select top sentences (up to 3) maintaining order
    const topSentences = sentenceScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.index - b.index)
      .map(s => s.sentence)
      .join(' ');

    // Detect email type based on keywords
    const lowerContent = content.toLowerCase();
    const isMarketing = /marketing|promotional|newsletter|sale|discount|offer|limited time|special offer|save now|shop now|buy now/i.test(lowerContent);
    
    // Detect urgency/action keywords
    let actionKeywords = [];
    if (/urgent|asap|immediately|today|reply|respond|confirm|approve/i.test(lowerContent)) {
      actionKeywords.push('Reply/Action needed');
    }
    if (/delete|unsubscribe|remove/i.test(lowerContent)) {
      actionKeywords.push('Unsubscribe/Delete');
    }
    if (/meeting|call|schedule|calendar|conference/i.test(lowerContent)) {
      actionKeywords.push('Schedule meeting');
    }

    const action = actionKeywords.length > 0 
      ? actionKeywords.join(' or ') 
      : 'Review';

    return {
      type: isMarketing ? 'marketing' : 'normal',
      summary: sanitizeContent(topSentences || content),
      action: action,
    };
  } catch (error) {
    console.log('⚠️ Natural summarization failed:', error.message);
    return {
      type: 'normal',
      summary: sanitizeContent(content),
      action: 'Review',
    };
  }
}

// Ollama-based summarization
async function generateOllamaSummary(content, ollamaConfig) {
  try {
    if (!content || content.length < 50) {
      return {
        type: 'normal',
        summary: sanitizeContent(content) || '(No content)',
        action: 'Review',
      };
    }

    console.log('🤖 Generating summary with Ollama...');

    const ollama = new Ollama({ base_url: ollamaConfig.baseUrl });
    
    const prompt = `Analyze this email and provide structured information.

EMAIL CONTENT:
${content}

RESPONSE FORMAT (JSON):
{
  "type": "marketing" OR "normal",
  "summary": "2-3 sentence summary ONLY",
  "action": "What action should user take? e.g., 'Reply within 2 days', 'Review quarterly numbers', 'Delete', 'No action needed'"
}

RULES:
- If email is promotional, marketing, newsletter, or sales: type="marketing"
- If asking for immediate action, mention it in action field
- Summary should be 2-3 sentences max
- Be concise

Respond ONLY with valid JSON.`;

    const response = await ollama.generate({
      model: ollamaConfig.model,
      prompt: prompt,
      stream: false,
    });

    const responseText = response.response.trim();
    
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(responseText);
      return {
        type: parsed.type || 'normal',
        summary: sanitizeContent(parsed.summary || content),
        action: parsed.action || 'Review',
      };
    } catch (e) {
      // Fallback if parsing fails
      return {
        type: 'normal',
        summary: sanitizeContent(responseText || content),
        action: 'Review',
      };
    }
  } catch (error) {
    console.log('⚠️ Ollama summarization failed:', error.message);
    return {
      type: 'normal',
      summary: sanitizeContent(content),
      action: 'Review',
    };
  }
}

// Main function to generate summary based on configured engine
async function generateSummary(content, engine = 'natural', ollamaConfig = {}) {
  if (!content || content.length < 30) {
    return {
      type: 'normal',
      summary: sanitizeContent(content) || '(No content)',
      action: 'Review',
    };
  }

  if (engine === 'ollama') {
    return await generateOllamaSummary(content, {
      model: ollamaConfig.model || 'mistral',
      baseUrl: ollamaConfig.baseUrl || 'http://localhost:11434',
    });
  } else {
    // Default to natural
    return generateNaturalSummary(content);
  }
}

module.exports = {
  generateSummary,
  sanitizeContent,
};
