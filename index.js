const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Load environment variables
const API_KEY = process.env.CONTENTSTACK_API_KEY?.trim();
const ENVIRONMENT = process.env.CONTENTSTACK_ENVIRONMENT?.trim();
const BASE_URL = process.env.BASE_URL?.trim();
const MANAGEMENT_TOKEN = process.env.CONTENTSTACK_MANAGEMENT_TOKEN?.trim();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Declare authtoken variable globally
let authtoken = null;

console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY);
console.log('BASE_URL:', BASE_URL);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ✨ ENHANCED: AI Confidence Scoring Function
function calculateConfidence(suggestion, context, findText) {
  let score = 50; // Base confidence score
  
  // Skip confidence calculation for very short texts
  if (!suggestion || suggestion.length < 2) return 25;
  
  // Boost confidence if suggestion is different from original
  if (suggestion.toLowerCase() !== findText.toLowerCase()) score += 15;
  
  // Check if suggestion appears in context (relevant)
  if (context && context.toLowerCase().includes(suggestion.toLowerCase())) score += 20;
  
  // Check word count similarity (maintains structure)
  const suggestionWords = suggestion.split(' ').length;
  const findWords = findText.split(' ').length;
  if (suggestionWords === findWords) score += 10;
  
  // Check capitalization consistency
  if (/^[A-Z]/.test(suggestion) === /^[A-Z]/.test(findText)) score += 5;
  
  // Check for proper nouns/entities (higher confidence)
  if (/^[A-Z][a-z]+/.test(suggestion)) score += 5;
  
  // Check length appropriateness
  if (suggestion.length >= findText.length * 0.5 && suggestion.length <= findText.length * 2) score += 5;
  
  // Penalize very short or single character suggestions
  if (suggestion.length === 1) score -= 30;
  
  // Boost for contextual keywords
  if (context) {
    const contextWords = context.toLowerCase().split(' ');
    const suggestionWords = suggestion.toLowerCase().split(' ');
    const overlap = suggestionWords.filter(word => contextWords.includes(word)).length;
    if (overlap > 0) score += overlap * 3;
  }
  
  // Ensure reasonable bounds
  return Math.min(Math.max(score, 15), 95);
}

// ✨ FIXED: Enhanced getSmartReplacement with better prompt
async function getSmartReplacement(findText, context) {
  try {
    console.log('Calling Gemini API...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // ✨ IMPROVED PROMPT - More specific and directive
    const prompt = `You are an expert content editor helping with smart text replacement.

Content context: "${context}"

Task: Replace the phrase "${findText}" with a contextually appropriate alternative.

Guidelines:
- Understand the MEANING and category of the original text
- For AI models: "Gemini 2.5 Pro" → "Claude Sonnet" (NOT "Claude 2.5 Pro")  
- For products: Replace with equivalent products from different companies
- For companies: Replace with comparable companies in the same industry
- For people: Replace with appropriate alternative names
- Maintain the same tone and context as the original

Examples of CORRECT replacements:
- "Gemini 2.5 Pro" → "Claude Sonnet"
- "OpenAI GPT-4" → "Anthropic Claude"
- "Google Cloud Platform" → "Microsoft Azure"
- "ChatGPT" → "Claude"
- "Microsoft" → "Apple"
- "Amazon Web Services" → "Google Cloud Platform"

Important: Return ONLY the replacement text, nothing else. No explanations, no quotes, just the replacement.`;

    console.log('Prompt length:', prompt.length);
    
    const result = await model.generateContent(prompt);
    console.log('Gemini API call successful');
    const response = await result.response;
    const suggestion = response.text().trim();
    
    // ✨ NEW: Calculate confidence score
    const confidence = calculateConfidence(suggestion, context, findText);
    
    console.log('Gemini response:', suggestion);
    console.log('Calculated confidence:', confidence);
    
    // Return both suggestion and confidence
    return { suggestion, confidence };
  } catch (error) {
    console.error('Gemini error details:', error.response?.data || error.message);
    return { suggestion: null, confidence: 0 };
  }
}

const fs = require('fs');
const path = require('path');

// Brandkit validation function (using exported JSON)
async function validateWithBrandkit(text) {
  try {
    // Load the exported Brandkit JSON
    const brandkitPath = path.join(__dirname, 'brandkit.json');
    const brandkitData = JSON.parse(fs.readFileSync(brandkitPath, 'utf8'));
    const style = brandkitData[0].communication_style; // Assuming first item

    // Basic validation based on communication_style
    const lowerText = text.toLowerCase();
    let score = 0;

    // Skip strict validation for very short texts (e.g., single words or simple replacements)
    if (text.split(' ').length <= 3) {
      score = 3; // Pass for short texts
    } else {
      // Formality check (higher formality_level means more formal words)
      if (style.formality_level > 3 && (lowerText.includes('please') || lowerText.includes('thank you'))) score++;
      if (style.formality_level <= 2 && (lowerText.includes('hey') || lowerText.includes('cool'))) score++;

      // Tone check (tone 2 might be neutral)
      if (style.tone === 2 && !lowerText.includes('!') && !lowerText.includes('?')) score++;

      // Humor check (higher humor_level allows more fun words)
      if (style.humor_level > 3 && (lowerText.includes('fun') || lowerText.includes('awesome'))) score++;

      // Complexity check (higher complexity_level allows longer sentences)
      if (style.complexity_level > 3 && text.split(' ').length > 10) score++;
    }

    // If score is low, reject
    if (score < 2) {
      throw new Error('Text does not match the brand communication style');
    }
  } catch (error) {
    throw new Error('Brandkit validation failed: ' + error.message);
  }
}

// Brandkit integration function
async function checkBrandGuidelines(text) {
  await validateWithBrandkit(text);
  return true;
}

// Deep replace function to handle nested objects, arrays, and text
function deepReplace(obj, findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex) {
  if (typeof obj === 'string') {
    // Apply general find & replace
    let result = obj.replace(new RegExp(findText, 'gi'), replaceText);
    // Apply entity replacements
    result = result.replace(emailRegex, (match) => match === findText ? replaceText : match);
    result = result.replace(personRegex, (match) => match === findText ? replaceText : match);
    result = result.replace(companyRegex, (match) => match === findText ? replaceText : match);
    // Apply link replacements
    result = result.replace(linkRegex, (match, href, text) => {
      if (href === findText) return `<a href="${replaceText}">${text}</a>`;
      if (text === findText) {
        let newHref = href;
        if (href.toLowerCase().includes(findText.toLowerCase())) {
          newHref = href.replace(new RegExp(findText, 'gi'), replaceText);
        }
        return `<a href="${newHref}">${replaceText}</a>`;
      }
      return match;
    });
    return result;
  } else if (Array.isArray(obj)) {
    return obj.map(item => deepReplace(item, findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex));
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      // Skip system fields
      if (['uid', 'created_at', '_version', 'created_by', 'updated_at', 'updated_by'].includes(key)) {
        newObj[key] = obj[key];
      } else {
        newObj[key] = deepReplace(obj[key], findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex);
      }
    }
    return newObj;
  }
  return obj;
}

async function login() {
  try {
    const response = await axios.post(`${BASE_URL}/user-session`, {
      user: {
        email: process.env.CONTENTSTACK_USER_EMAIL,
        password: process.env.CONTENTSTACK_USER_PASSWORD
      }
    });
    authtoken = response.data.user.authtoken;
    console.log('Logged in successfully');
    console.log('Login response data:', response.data);
    console.log('Authtoken set to:', authtoken);
    return authtoken;
  } catch (error) {
    console.error('Login failed:', error.response?.data || error.message);
    throw error;
  }
}

const app = express();
app.use(express.json());
const corsOptions = {
  origin: [
    'https://frontend-app.eu-contentstackapps.com',
    'http://localhost:3000', // For development
    'https://backend-f4ee.vercel.app' // Allow backend itself
  ],
  credentials: true,
};

app.use(cors(corsOptions));

// ------------------ FETCH ENTRIES ------------------
app.get('/entries', async (req, res) => {
  try {
    console.log('Authtoken before login check:', authtoken);
    if (!authtoken) {
      console.log('Calling login...');
      await login();
      console.log('Login completed, authtoken:', authtoken);
    } else {
      console.log('Using existing authtoken');
    }
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }
    
    const response = await axios.get(`${BASE_URL}/content_types/article/entries`, {
      params: { environment: ENVIRONMENT },
      headers: {
        api_key: API_KEY,
        access_token: authtoken
      }
    });
    res.json(response.data.entries);
  } catch (error) {
    console.error("Error fetching entries:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

// ✨ UPDATED: Enhanced suggest endpoint with confidence scoring
app.post('/suggest', async (req, res) => {
  const { uid, findText } = req.body;
  if (!uid || !findText) {
    return res.status(400).json({ error: 'uid and findText are required' });
  }

  try {
    await login(); // Ensure valid authtoken
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }
    
    const entryResponse = await axios.get(`${BASE_URL}/content_types/article/entries/${uid}`, {
      params: { environment: ENVIRONMENT },
      headers: {
        api_key: API_KEY,
        access_token: authtoken
      }
    });
    const context = entryResponse.data.entry.body;
    const result = await getSmartReplacement(findText, context);
    
    if (result.suggestion) {
      // ✨ NEW: Return both suggestion and confidence
      res.json({ 
        suggestion: result.suggestion,
        confidence: result.confidence 
      });
    } else {
      res.status(500).json({ error: 'Could not generate suggestion' });
    }
  } catch (error) {
    console.error('Error getting suggestion:', error);
    res.status(500).json({ error: 'Failed to get suggestion' });
  }
});

// ------------------ REPLACE TEXT IN ENTRY ------------------
app.post('/replace', async (req, res) => {
  console.log('Replace request received:', req.body);
  const { uid, findText, replaceText, replaceUrl, replaceEmail } = req.body;

  console.log('Replace request received:', req.body);
  console.log('Find text:', findText, 'Replace text:', replaceText, 'Replace URL:', replaceUrl, 'Replace Email:', replaceEmail);

  if (!uid || !findText || !replaceText) {
    return res.status(400).json({ error: "uid, findText and replaceText are required" });
  }

  try {
    await login(); // Refresh authtoken
    console.log('Fetching entry');
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }

    // Check brand guidelines before proceeding
    await checkBrandGuidelines(replaceText);
    console.log('Brand guidelines passed');
    
    // 1️⃣ Fetch the entry
    const entryResponse = await axios.get(`${BASE_URL}/content_types/article/entries/${uid}`, {
      params: { environment: ENVIRONMENT },
      headers: {
        api_key: API_KEY,
        access_token: authtoken
      }
    });
    console.log('Entry fetched');
    const entry = entryResponse.data.entry;
    const locale = entry.locale || 'en-us';

    // Regex for emails and links
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;

    // Named entity regex
    const personRegex = /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g; // Simple person name regex (e.g., John Doe)
    const companyRegex = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Inc|Corp|LLC|Company|Ltd)\b/g; // Simple company name regex (e.g., Alpha Company Inc)

    // Apply deep replace to the entire entry for deep content coverage
    const updatedEntry = deepReplace(entry, findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex);

    console.log('Updated body:', updatedEntry.body);

    console.log('Updating entry');
    // 3️⃣ Update the entry with deep replaced data
    await axios.put(`${BASE_URL}/content_types/article/entries/${uid}`,
      { entry: updatedEntry },
      {
        params: { environment: ENVIRONMENT },
        headers: {
          api_key: API_KEY,
          access_token: authtoken,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Entry updated via PUT');

    console.log('Publishing entry');
    // 4️⃣ Publish the entry
    await axios.post(`${BASE_URL}/content_types/article/entries/${uid}/publish`,
      { entry: { environments: [ENVIRONMENT], locales: [locale] } },
      {
        params: { environment: ENVIRONMENT },
        headers: {
          api_key: API_KEY,
          access_token: authtoken,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Entry published');
    res.json({ message: "Entry updated successfully" });
  } catch (error) {
    console.error("Error updating entry:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// ------------------ START SERVER ------------------
const PORT = process.env.PORT || 5000;

// Handle login failure on startup
login().catch(err => {
  console.warn('Initial login failed, will retry when needed:', err.message);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
