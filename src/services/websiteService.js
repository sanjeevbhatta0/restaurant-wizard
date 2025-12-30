import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

const generateSlug = (name) => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
};

const generateHtml = (data) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.home.title}</title>
    <link href="https://fonts.googleapis.com/css2?family=${data.theme.fontFamily}:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: ${data.theme.primaryColor};
            --secondary-color: ${data.theme.secondaryColor};
            --font-family: '${data.theme.fontFamily}', sans-serif;
        }
        body {
            font-family: var(--font-family);
            line-height: 1.6;
            margin: 0;
            padding: 0;
        }
        header {
            background-color: var(--primary-color);
            color: white;
            padding: 2rem 0;
            text-align: center;
        }
        main {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        .content {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        footer {
            background-color: var(--secondary-color);
            color: white;
            padding: 2rem 0;
            text-align: center;
            margin-top: 2rem;
        }
        .contact {
            max-width: 600px;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <header>
        <h1>${data.home.title}</h1>
        <p>${data.home.subtitle}</p>
    </header>
    <main>
        <div class="content">
            ${data.home.content}
        </div>
    </main>
    <footer>
        <div class="contact">
            <p>Phone: ${data.contact.phone}</p>
            <p>Email: ${data.contact.email}</p>
            <p>Address: ${data.contact.address}</p>
        </div>
    </footer>
</body>
</html>
    `;
};

export const updateWebsiteData = async (restaurantId, data) => {
    try {
        // Get restaurant data to check/update slug
        const restaurantDoc = await getDoc(doc(db, `restaurants/${restaurantId}`));
        if (!restaurantDoc.exists()) {
            throw new Error('Restaurant not found');
        }

        const restaurantData = restaurantDoc.data();
        const slug = restaurantData.slug || generateSlug(data.home.title);

        // Update restaurant data with slug if needed
        if (!restaurantData.slug) {
            await setDoc(doc(db, `restaurants/${restaurantId}`), {
                ...restaurantData,
                slug
            }, { merge: true });
        }

        // Update website data in Firestore
        await setDoc(doc(db, `restaurants/${restaurantId}/website/data`), data);

        // Generate HTML
        const html = generateHtml(data);

        // Call the Cloud Function to update the website
        const functions = getFunctions();
        const updateWebsite = httpsCallable(functions, 'updateWebsite');

        const result = await updateWebsite({
            html,
            restaurantId,
            slug
        });

        return {
            ...result.data,
            slug,
            websiteUrl: `https://${slug}.restaurant-portal-6b147.web.app`
        };
    } catch (error) {
        console.error('Error updating website:', error);
        throw error;
    }
}; 