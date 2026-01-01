# Setting Up Gemini API for AI Content Generation

This guide explains how to set up the Gemini API key needed for the "Generate Ideas" feature in the SEO & Social module.

## Quick Setup (2 minutes)

### Step 1: Get Your Gemini API Key

1. Go to **[Google AI Studio](https://makersuite.google.com/app/apikey)** (or https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the generated key

### Step 2: Add the Key to Your Project

Open the file `functions/.env` and replace the placeholder with your actual API key:

```env
GEMINI_API_KEY=AIzaSy...your-actual-key-here
```

### Step 3: Deploy the Functions

Run this command from your project root:

```bash
cd functions && npm run deploy
```

Or deploy everything:

```bash
firebase deploy --only functions
```

---

## Testing Locally

If you're testing locally with emulators, the `.env` file in the functions folder will be automatically loaded.

Start the emulators:
```bash
firebase emulators:start
```

---

## Troubleshooting

### "Gemini API key not configured" error
- Make sure the `.env` file exists in the `functions/` folder (not the project root)
- Verify the key doesn't have any extra spaces or quotes
- Redeploy functions after adding the key

### API quota exceeded
- The free tier allows 60 requests per minute
- Consider upgrading to a paid plan for higher limits

### Invalid API key
- Regenerate the key from Google AI Studio
- Make sure you're using the correct project

---

## Security Notes

- ✅ The `functions/.env` file is already in `.gitignore`
- ⚠️ Never commit API keys to version control
- 💡 For production, consider using Google Cloud Secret Manager
