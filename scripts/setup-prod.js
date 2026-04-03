// Script to set up production Firestore with essential data
// Run via: GOOGLE_CLOUD_PROJECT=kodacarte-861d8 node scripts/setup-prod.js

const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'kodacarte-861d8'
});

const db = admin.firestore();

async function setup() {
  console.log('Setting up production Firestore for kodacarte-861d8...\n');

  // 1. Create platformConfig (pricing tiers — needed for landing page & signup)
  const tiers = {
    scout: { name: 'Scout', icon: '🔍', price: 0, menuItemLimit: 10, orderLimit: 75, features: ['menu', 'pos', 'kitchen', 'server', 'orders'] },
    ally: { name: 'Ally', icon: '🌱', price: 29, menuItemLimit: -1, orderLimit: 500, features: ['menu', 'pos', 'kitchen', 'server', 'orders', 'aiMenuUpload'] },
    guide: { name: 'Guide', icon: '🧭', price: 59, menuItemLimit: -1, orderLimit: 2000, features: ['menu', 'pos', 'kitchen', 'server', 'orders', 'aiMenuUpload', 'analytics', 'websiteBuilder', 'websiteIntegration'] },
    chief: { name: 'Chief', icon: '🦅', price: 99, menuItemLimit: -1, orderLimit: 5000, features: ['menu', 'pos', 'kitchen', 'server', 'orders', 'aiMenuUpload', 'analytics', 'websiteBuilder', 'websiteIntegration', 'seoSocial', 'aiPreview'], mostPopular: true },
    elder: { name: 'Elder', icon: '👑', price: 229, menuItemLimit: -1, orderLimit: -1, features: ['menu', 'pos', 'kitchen', 'server', 'orders', 'aiMenuUpload', 'analytics', 'websiteBuilder', 'websiteIntegration', 'seoSocial', 'aiPreview', 'aiAnalytics', 'aiContent'] }
  };

  const billingMultipliers = { monthly: 1.2, quarterly: 1.1, annual: 1.0 };

  await db.collection('platformConfig').doc('tiers').set({
    tiers,
    billingMultipliers,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('✅ platformConfig/tiers created');

  await db.collection('platformConfig').doc('features').set({
    allFeatures: [
      'menu', 'pos', 'kitchen', 'server', 'orders', 'aiMenuUpload',
      'analytics', 'websiteBuilder', 'websiteIntegration', 'seoSocial',
      'aiPreview', 'aiAnalytics', 'aiContent', 'promotions', 'reviews',
      'tableLayout', 'payments'
    ],
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('✅ platformConfig/features created');

  console.log('\n🎉 Production setup complete!');
  console.log('Next: Sign up as admin at https://kodacarte-861d8.web.app, then run add-admin-prod with the new UID.');
  process.exit(0);
}

setup().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
