#!/usr/bin/env node
/**
 * Script to upload website templates to Firebase Storage
 * Run with: node scripts/upload-templates.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'restaurant-portal-6b147.appspot.com'
});

const bucket = admin.storage().bucket();

const TEMPLATES_DIR = path.join(__dirname, '../public/templates');

async function uploadTemplates() {
  console.log('🚀 Starting template upload...\n');
  
  const templateDirs = fs.readdirSync(TEMPLATES_DIR).filter(item => {
    const itemPath = path.join(TEMPLATES_DIR, item);
    return fs.statSync(itemPath).isDirectory();
  });

  for (const templateId of templateDirs) {
    const templatePath = path.join(TEMPLATES_DIR, templateId, 'template.html');
    
    if (fs.existsSync(templatePath)) {
      console.log(`📦 Uploading template: ${templateId}`);
      
      try {
        const templateHtml = fs.readFileSync(templatePath, 'utf-8');
        const file = bucket.file(`templates/${templateId}/template.html`);
        
        await file.save(templateHtml, {
          metadata: {
            contentType: 'text/html',
            cacheControl: 'public, max-age=3600'
          }
        });
        
        console.log(`   ✅ ${templateId} uploaded successfully`);
      } catch (error) {
        console.error(`   ❌ Failed to upload ${templateId}:`, error.message);
      }
    } else {
      console.log(`   ⚠️ No template.html found in ${templateId}`);
    }
  }

  console.log('\n✨ Template upload complete!');
  process.exit(0);
}

uploadTemplates().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
