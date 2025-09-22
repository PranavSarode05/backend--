# Smart Find & Replace Backend API

This repository contains the backend API implementation for the Smart Find & Replace Contentstack marketplace app. The API provides AI-powered content replacement services with intelligent suggestions, brand compliance validation, and natural language command processing.

## Features

**AI-Powered Text Replacement**: Google Gemini 2.0 Flash integration for contextual content suggestions
- Intelligent replacement suggestions with confidence scoring algorithm
- Context-aware analysis for maintaining content relevance
- Advanced prompt engineering for accurate AI responses

**Brand Compliance Validation**: Automated content validation against brand guidelines
- Brandkit JSON integration for communication style validation
- Formality level, tone, and complexity scoring
- Automatic approval for short text replacements
- Detailed compliance reporting with specific violation reasons

**Deep Content Replacement**: Comprehensive content processing across entry structures
- Nested object and array traversal for complete content coverage
- URL and link pattern matching with intelligent updates

## How It Works

**Authentication Flow**:
- User session management with Contentstack credentials
- Automatic token refresh and validation
- Secure API key and management token handling

**Content Processing Pipeline**:
- Entry retrieval using Contentstack Management API
- AI-powered suggestion generation with context analysis
- Brand compliance validation against exported brandkit rules
- Deep content replacement with pattern matching and entity recognition
- Entry update and automatic publishing to specified environments

**Smart Prompt Processing**:
- Natural language command parsing using multiple regex patterns
- AI-enhanced operation suggestion for incomplete commands
- Brand compliance validation across all generated operations

## Technologies Used

- **Backend Framework**: Node.js with Express.js for RESTful API services
- **AI Integration**: Google Gemini 2.0 Flash for intelligent content processing
- **Content Management**: Contentstack Management API for entry operations
- **HTTP Client**: Axios for external API communication and error handling
- **Environment Management**: dotenv for secure configuration management
- **Content Processing**: Custom algorithms for deep object traversal and pattern matching

## Installation

Clone this repository:
```bash
git clone https://github.com/PranavSarode05/backend--.git
```

Navigate to the project directory:
```bash
cd backend
```

Install dependencies:
```bash
npm install
```

Create environment variables file:
```bash
cp .env.example .env
```

Configure environment variables in `.env`:
```bash
CONTENTSTACK_API_KEY=your_contentstack_api_key
CONTENTSTACK_ENVIRONMENT=your_environment_name
CONTENTSTACK_MANAGEMENT_TOKEN=your_management_token
CONTENTSTACK_USER_EMAIL=your_contentstack_email
CONTENTSTACK_USER_PASSWORD=your_contentstack_password
BASE_URL=https://api.contentstack.io/v3
GEMINI_API_KEY=your_google_gemini_api_key
PORT=5000
```

Add brandkit.json file for brand compliance validation:

Export your brandkit from Contentstack and place as brandkit.json

Start the development server:
```bash
node index.js
```

Or start production server:
```bash
npm start
```

## Related Repositories

- [Frontend App](https://github.com/PranavSarode05/frontend) - React/Vanilla JS marketplace application


