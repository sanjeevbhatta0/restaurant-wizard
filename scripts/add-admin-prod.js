// Script to add admin user to Firestore
// Run via: node scripts/add-admin-prod.js

const admin = require('firebase-admin');

// Initialize with default credentials (uses gcloud auth)
admin.initializeApp({
    projectId: 'restaurant-portal-6b147'
});

const db = admin.firestore();

async function addAdmin() {
    const adminUid = 'Jv3rd8hTJCRrwlG4w5OHFVGIzyK2';

    try {
        await db.collection('admins').doc(adminUid).set({
            email: 'sanjeev@admin.com',
            role: 'admin',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('✅ Admin user added successfully!');
        console.log('UID:', adminUid);
        console.log('Email: sanjeev@admin.com');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error adding admin:', error.message);
        process.exit(1);
    }
}

addAdmin();
