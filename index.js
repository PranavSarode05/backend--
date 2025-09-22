const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.CONTENTSTACK_API_KEY?.trim();
const ENVIRONMENT = process.env.CONTENTSTACK_ENVIRONMENT?.trim();
const BASE_URL = process.env.BASE_URL?.trim();
const MANAGEMENT_TOKEN = process.env.CONTENTSTACK_MANAGEMENT_TOKEN?.trim();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

function calculateConfidence(suggestion, context, findText) {
  let score = 50;
  
  if (!suggestion || suggestion.length < 2) return 25;
  
  if (suggestion.toLowerCase() !== findText.toLowerCase()) score += 15;
  
  if (context && context.toLowerCase().includes(suggestion.toLowerCase())) score += 20;
  
  const suggestionWords = suggestion.split(' ').length;
  const findWords = findText.split(' ').length;
  if (suggestionWords === findWords) score += 10;
  
  if (/^[A-Z]/.test(suggestion) === /^[A-Z]/.test(findText)) score += 5;
  
  if (/^[A-Z][a-z]+/.test(suggestion)) score += 5;
  
  if (suggestion.length >= findText.length * 0.5 && suggestion.length <= findText.length * 2) score += 5;
  
  if (suggestion.length === 1) score -= 30;
  
  if (context) {
    const contextWords = context.toLowerCase().split(' ');
    const suggestionWords = suggestion.toLowerCase().split(' ');
    const overlap = suggestionWords.filter(word => contextWords.includes(word)).length;
    if (overlap > 0) score += overlap * 3;
  }
  
  return Math.min(Math.max(score, 15), 95);
}

async function getSmartReplacement(findText, context) {
  try {
    console.log('Calling Gemini API...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
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
    
    const confidence = calculateConfidence(suggestion, context, findText);
    
    console.log('Gemini response:', suggestion);
    console.log('Calculated confidence:', confidence);
    
    return { suggestion, confidence };
  } catch (error) {
    console.error('Gemini error details:', error.response?.data || error.message);
    return { suggestion: null, confidence: 0 };
  }
}

function parseSmartPrompt(input) {
  const operations = [];
  
  const replacePattern = /replace\s*["']([^"']+)["']\s*with\s*["']([^"']+)["']/gi;
  let match;
  
  while ((match = replacePattern.exec(input)) !== null) {
    operations.push({
      type: 'replace',
      findText: match[1].trim(),
      replaceText: match[2].trim()
    });
  }
  
  const fieldPattern = /(?:set|update|change)\s+([a-zA-Z_]+)\s+to\s+["']([^"']+)["']/gi;
  while ((match = fieldPattern.exec(input)) !== null) {
    operations.push({
      type: 'field_update',
      fieldName: match[1].trim(),
      newValue: match[2].trim()
    });
  }
  
  const andPattern = /and\s+([a-zA-Z_]+)\s+to\s+["']([^"']+)["']/gi;
  while ((match = andPattern.exec(input)) !== null) {
    operations.push({
      type: 'field_update',
      fieldName: match[1].trim(),
      newValue: match[2].trim()
    });
  }
  
  return {
    originalInput: input,
    operations: operations,
    isValid: operations.length > 0
  };
}

async function getSmartPromptSuggestion(smartPrompt, context) {
  try {
    console.log('Processing smart prompt with AI...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `You are an expert content editor processing a smart replacement command.

Content context: "${context}"

User command: "${smartPrompt}"

Task: Parse this command and provide intelligent suggestions for any missing parts.

For example:
- If user says "Replace John Smith with Hardik Patel and designation to Manager"
- You understand: Replace person name AND update a field

Provide a JSON response with:
{
  "operations": [
    {"type": "replace", "findText": "found text", "replaceText": "suggested replacement"},
    {"type": "field_update", "fieldName": "field name", "newValue": "new value"}
  ],
  "confidence": 85
}

Important: Return ONLY valid JSON, no explanations.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonResponse = response.text().trim();
    
    try {
      return JSON.parse(jsonResponse);
    } catch (parseError) {
      console.error('Failed to parse AI JSON response:', parseError);
      return { operations: [], confidence: 0 };
    }
  } catch (error) {
    console.error('Smart prompt AI error:', error);
    return { operations: [], confidence: 0 };
  }
}

const fs = require('fs');
const path = require('path');

async function validateWithBrandkit(text) {
  try {
    // Load the exported Brandkit JSON
    const brandkitPath = path.join(__dirname, 'brandkit.json');
    const brandkitData = JSON.parse(fs.readFileSync(brandkitPath, 'utf8'));
    const style = brandkitData[0].communication_style; // Assuming first item

    const lowerText = text.toLowerCase();
    let score = 0;

    if (text.split(' ').length <= 3) {
      score = 3; 
    } else {
      if (style.formality_level > 3 && (lowerText.includes('please') || lowerText.includes('thank you'))) score++;
      if (style.formality_level <= 2 && (lowerText.includes('hey') || lowerText.includes('cool'))) score++;

      if (style.tone === 2 && !lowerText.includes('!') && !lowerText.includes('?')) score++;

      if (style.humor_level > 3 && (lowerText.includes('fun') || lowerText.includes('awesome'))) score++;

      if (style.complexity_level > 3 && text.split(' ').length > 10) score++;
    }

    if (score < 2) {
      throw new Error('Text does not match the brand communication style');
    }
  } catch (error) {
    throw new Error('Brandkit validation failed: ' + error.message);
  }
}

async function checkBrandGuidelines(text) {
  await validateWithBrandkit(text);
  return true;
}

function deepReplace(obj, findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex) {
  if (typeof obj === 'string') {
    let result = obj.replace(new RegExp(findText, 'gi'), replaceText);
    result = result.replace(emailRegex, (match) => match === findText ? replaceText : match);
    result = result.replace(personRegex, (match) => match === findText ? replaceText : match);
    result = result.replace(companyRegex, (match) => match === findText ? replaceText : match);
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

function applyFieldUpdates(entry, fieldUpdates) {
  console.log('Applying field updates:', fieldUpdates);
  console.log('Available entry fields:', Object.keys(entry));
  
  for (const [fieldName, newValue] of Object.entries(fieldUpdates)) {
    const lowerFieldName = fieldName.toLowerCase();
    let fieldUpdated = false;
    
        if (['contact', 'email', 'contact_email', 'contact_info'].includes(lowerFieldName)) {
      if (entry.email !== undefined) { entry.email = newValue; fieldUpdated = true; }
      else if (entry.contact !== undefined) { entry.contact = newValue; fieldUpdated = true; }
      else if (entry.contact_email !== undefined) { entry.contact_email = newValue; fieldUpdated = true; }
      else if (entry.contact_info !== undefined) { entry.contact_info = newValue; fieldUpdated = true; }
    }
    
    else if (['company', 'organization', 'company_name', 'org'].includes(lowerFieldName)) {
      if (entry.company !== undefined) { entry.company = newValue; fieldUpdated = true; }
      else if (entry.organization !== undefined) { entry.organization = newValue; fieldUpdated = true; }
      else if (entry.company_name !== undefined) { entry.company_name = newValue; fieldUpdated = true; }
      else if (entry.org !== undefined) { entry.org = newValue; fieldUpdated = true; }
    }
    
    else if (['title', 'heading', 'name'].includes(lowerFieldName)) {
      if (entry.title !== undefined) { entry.title = newValue; fieldUpdated = true; }
      else if (entry.heading !== undefined) { entry.heading = newValue; fieldUpdated = true; }
      else if (entry.name !== undefined) { entry.name = newValue; fieldUpdated = true; }
    }
    
    else if (['designation', 'role', 'position', 'job_title'].includes(lowerFieldName)) {
      if (entry.designation !== undefined) { entry.designation = newValue; fieldUpdated = true; }
      else if (entry.role !== undefined) { entry.role = newValue; fieldUpdated = true; }
      else if (entry.position !== undefined) { entry.position = newValue; fieldUpdated = true; }
      else if (entry.job_title !== undefined) { entry.job_title = newValue; fieldUpdated = true; }
    }
    
    else if (['author', 'writer', 'created_by_name'].includes(lowerFieldName)) {
      if (entry.author !== undefined) { entry.author = newValue; fieldUpdated = true; }
      else if (entry.writer !== undefined) { entry.writer = newValue; fieldUpdated = true; }
      else if (entry.created_by_name !== undefined) { entry.created_by_name = newValue; fieldUpdated = true; }
    }
    
    else if (['description', 'summary', 'excerpt'].includes(lowerFieldName)) {
      if (entry.description !== undefined) { entry.description = newValue; fieldUpdated = true; }
      else if (entry.summary !== undefined) { entry.summary = newValue; fieldUpdated = true; }
      else if (entry.excerpt !== undefined) { entry.excerpt = newValue; fieldUpdated = true; }
    }
    
    else {
      if (entry[fieldName] !== undefined) {
        entry[fieldName] = newValue;
        fieldUpdated = true;
      } else if (entry[lowerFieldName] !== undefined) {
        entry[lowerFieldName] = newValue;
        fieldUpdated = true;
      } else {
        console.log(`Adding new field: ${fieldName} = ${newValue}`);
        entry[fieldName] = newValue;
        fieldUpdated = true;
      }
    }
    
    if (fieldUpdated) {
      console.log(`✅ Updated field: ${fieldName} = ${newValue}`);
    } else {
      console.warn(`⚠️ Field not found in entry: ${fieldName}`);
    }
  }
  
  return entry;
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

app.get('/debug-entry/:uid', async (req, res) => {
  try {
    await login();
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }
    
    const entryResponse = await axios.get(`${BASE_URL}/content_types/article/entries/${req.params.uid}`, {
      params: { environment: ENVIRONMENT },
      headers: {
        api_key: API_KEY,
        access_token: authtoken
      }
    });
    
    const entry = entryResponse.data.entry;
    const fields = Object.keys(entry);
    
    console.log('Entry fields:', fields);
    res.json({ 
      uid: entry.uid,
      fields: fields,
      fieldTypes: Object.keys(entry).map(key => ({
        name: key,
        type: typeof entry[key],
        value: Array.isArray(entry[key]) ? '[Array]' : 
               typeof entry[key] === 'object' ? '[Object]' : 
               String(entry[key]).substring(0, 100)
      }))
    });
  } catch (error) {
    console.error('Debug entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

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

app.post('/suggest', async (req, res) => {
  const { uid, findText } = req.body;
  if (!uid || !findText) {
    return res.status(400).json({ error: 'uid and findText are required' });
  }

  try {
    await login();
    
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

app.post('/smart-suggest', async (req, res) => {
  const { uid, smartPrompt } = req.body;
  
  if (!uid || !smartPrompt) {
    return res.status(400).json({ error: 'uid and smartPrompt are required' });
  }

  try {
    await login();
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }
    
    const entryResponse = await axios.get(`${BASE_URL}/content_types/article/entries/${uid}`, {
      params: { environment: ENVIRONMENT },
      headers: { api_key: API_KEY, access_token: authtoken }
    });
    
    const context = entryResponse.data.entry.body;
    
    const parsed = parseSmartPrompt(smartPrompt);
    
    if (!parsed.isValid) {
      return res.status(400).json({ 
        error: 'Could not understand the prompt. Try: Replace "old text" with "new text"' 
      });
    }
    
    const processedOperations = [];
    
    for (const operation of parsed.operations) {
      if (operation.type === 'replace') {
        let finalReplacement = operation.replaceText;
        let confidence = 85;
        
        if (!finalReplacement) {
          const aiResult = await getSmartReplacement(operation.findText, context);
          finalReplacement = aiResult.suggestion;
          confidence = aiResult.confidence;
        }
        
        let brandCompliant = true;
        let brandMessage = '';
        
        try {
          await checkBrandGuidelines(finalReplacement);
          brandMessage = 'Brand compliant';
        } catch (brandError) {
          brandCompliant = false;
          brandMessage = brandError.message;
        }
        
        processedOperations.push({
          type: 'replace',
          findText: operation.findText,
          replaceText: finalReplacement,
          confidence: confidence,
          brandCompliant: brandCompliant,
          brandMessage: brandMessage
        });
      } else if (operation.type === 'field_update') {
        let brandCompliant = true;
        let brandMessage = '';
        
        try {
          await checkBrandGuidelines(operation.newValue);
          brandMessage = 'Brand compliant';
        } catch (brandError) {
          brandCompliant = false;
          brandMessage = brandError.message;
        }
        
        processedOperations.push({
          type: 'field_update',
          fieldName: operation.fieldName,
          newValue: operation.newValue,
          brandCompliant: brandCompliant,
          brandMessage: brandMessage
        });
      }
    }
    
    res.json({
      originalPrompt: smartPrompt,
      operations: processedOperations,
      brandCompliant: processedOperations.every(op => op.brandCompliant)
    });
    
  } catch (error) {
    console.error('Smart prompt error:', error);
    res.status(500).json({ error: 'Failed to process smart prompt' });
  }
});

app.post('/smart-replace', async (req, res) => {
  const { uid, operations } = req.body;
  
  if (!uid || !operations || !Array.isArray(operations)) {
    return res.status(400).json({ error: 'uid and operations array are required' });
  }

  try {
    await login();
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }
    
    const entryResponse = await axios.get(`${BASE_URL}/content_types/article/entries/${uid}`, {
      params: { environment: ENVIRONMENT },
      headers: { api_key: API_KEY, access_token: authtoken }
    });
    
    let entry = entryResponse.data.entry;
    const locale = entry.locale || 'en-us';
    
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const personRegex = /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g;
    const companyRegex = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Inc|Corp|LLC|Company|Ltd)\b/g;
    
    const fieldUpdates = {};
    
    for (const operation of operations) {
      if (operation.type === 'replace') {
        entry = deepReplace(entry, operation.findText, operation.replaceText, 
                           emailRegex, personRegex, companyRegex, linkRegex);
      } else if (operation.type === 'field_update') {
        fieldUpdates[operation.fieldName] = operation.newValue;
      }
    }
    
    if (Object.keys(fieldUpdates).length > 0) {
      entry = applyFieldUpdates(entry, fieldUpdates);
    }
    
    console.log('Updated entry with smart operations');
    
    await axios.put(`${BASE_URL}/content_types/article/entries/${uid}`,
      { entry: entry },
      {
        params: { environment: ENVIRONMENT },
        headers: {
          api_key: API_KEY,
          access_token: authtoken,
          'Content-Type': 'application/json'
        }
      }
    );
    
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
    
    res.json({ 
      message: 'Smart replacement completed successfully',
      operationsApplied: operations.length
    });
    
  } catch (error) {
    console.error('Smart replace error:', error);
    res.status(500).json({ error: 'Failed to execute smart replacement' });
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
    await login();
    console.log('Fetching entry');
    
    if (!authtoken) {
      throw new Error('Failed to obtain authentication token');
    }

    await checkBrandGuidelines(replaceText);
    console.log('Brand guidelines passed');
    
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

    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;

    const personRegex = /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g;
    const companyRegex = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Inc|Corp|LLC|Company|Ltd)\b/g;

    const updatedEntry = deepReplace(entry, findText, replaceText, emailRegex, personRegex, companyRegex, linkRegex);

    console.log('Updated body:', updatedEntry.body);

    console.log('Updating entry');
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

login().catch(err => {
  console.warn('Initial login failed, will retry when needed:', err.message);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
