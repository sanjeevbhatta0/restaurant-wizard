// Admin Setup Script - Run this once to create admin user
// Usage: node scripts/setup-admin.js

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, setDoc } = require('firebase/firestore');

// Firebase config (same as in src/firebase.js)
const firebaseConfig = {
    apiKey: "AIzaSyD3ybDAeaVQzJ8W6UkNzq-A0VHhzR_V2BA",
    authDomain: "restaurant-portal-6b147.firebaseapp.com",
    projectId: "restaurant-portal-6b147",
    storageBucket: "restaurant-portal-6b147.appspot.com",
    messagingSenderId: "803292302547",
    appId: "1:803292302547:web:8ec01ea3fa1e4e66fe929f"
};

async function setupAdmin() {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Connect to emulators
    try {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
        connectFirestoreEmulator(db, 'localhost', 8080);
        console.log('✅ Connected to Firebase emulators');
    } catch (e) {
        console.log('⚠️  Emulator connection note:', e.message);
    }

    const email = 'sanjeev@admin.com';
    const password = 'sanjeev';

    try {
        // Try to create the user
        console.log(`\n📝 Creating admin user: ${email}`);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        console.log(`✅ User created with UID: ${uid}`);

        // Add to admins collection
        console.log('\n📝 Adding user to admins collection...');
        await setDoc(doc(db, 'admins', uid), {
            email: email,
            role: 'admin',
            createdAt: new Date().toISOString()
        });
        console.log('✅ User added to admins collection!');

        console.log('\n🎉 Admin setup complete!');
        console.log('----------------------------------------');
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log(`UID: ${uid}`);
        console.log('----------------------------------------');
        console.log('\nYou can now login at: http://localhost:3000/admin');

    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            console.log('⚠️  User already exists, signing in to get UID...');
            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const uid = userCredential.user.uid;
                console.log(`✅ Signed in! UID: ${uid}`);

                // Ensure they're in admins collection
                await setDoc(doc(db, 'admins', uid), {
                    email: email,
                    role: 'admin',
                    createdAt: new Date().toISOString()
                });
                console.log('✅ Ensured user is in admins collection!');

                console.log('\n🎉 Admin ready!');
                console.log('----------------------------------------');
                console.log(`Email: ${email}`);
                console.log(`Password: ${password}`);
                console.log(`UID: ${uid}`);
                console.log('----------------------------------------');
                console.log('\nYou can now login at: http://localhost:3000/admin');
            } catch (signInError) {
                console.error('❌ Error signing in:', signInError.message);
            }
        } else {
            console.error('❌ Error creating user:', error.message);
        }
    }

    process.exit(0);
}

setupAdmin();
