/**
 * Customer Portal - Mock Data
 * 
 * Sample data interfaces for development and testing.
 * In production, this data would come from Firestore.
 */

const MockData = {
    // Sample user for development
    user: {
        id: 'user_demo_123',
        email: 'john.doe@example.com',
        fullName: 'John Doe',
        phone: '(555) 123-4567',
        address: '123 Main Street, Suite 100, Austin, TX 78701',
        rewardPoints: 750,
        nextRewardAt: 1000,
        memberSince: '2025-06-15',
        tier: 'Gold Member'
    },

    // Sample orders
    orders: [
        {
            id: 'order_001',
            orderNumber: '#1247',
            date: '2025-12-28',
            total: 45.99,
            status: 'delivered',
            items: [
                { name: 'Margherita Pizza', quantity: 1, price: 18.99 },
                { name: 'Caesar Salad', quantity: 2, price: 12.00 },
                { name: 'Garlic Bread', quantity: 1, price: 6.99 }
            ]
        },
        {
            id: 'order_002',
            orderNumber: '#1198',
            date: '2025-12-20',
            total: 32.50,
            status: 'picked_up',
            items: [
                { name: 'Pasta Carbonara', quantity: 1, price: 16.99 },
                { name: 'Tiramisu', quantity: 1, price: 8.99 },
                { name: 'Cappuccino', quantity: 2, price: 6.50 }
            ]
        },
        {
            id: 'order_003',
            orderNumber: '#1156',
            date: '2025-12-15',
            total: 67.25,
            status: 'delivered',
            items: [
                { name: 'Family Pizza Combo', quantity: 1, price: 42.99 },
                { name: 'Wings (12pc)', quantity: 1, price: 14.99 },
                { name: 'Soft Drinks (4)', quantity: 1, price: 9.27 }
            ]
        },
        {
            id: 'order_004',
            orderNumber: '#1089',
            date: '2025-12-01',
            total: 28.99,
            status: 'delivered',
            items: [
                { name: 'Chicken Parmesan', quantity: 1, price: 19.99 },
                { name: 'House Salad', quantity: 1, price: 9.00 }
            ]
        }
    ],

    // Sample promotions
    promotions: [
        {
            id: 'promo_001',
            title: 'Weekend Special',
            description: 'Get 20% off all pasta dishes every Friday-Sunday!',
            image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=400&h=250&fit=crop',
            code: 'PASTA20',
            discount: '20%',
            validUntil: '2026-01-31'
        },
        {
            id: 'promo_002',
            title: 'Free Dessert',
            description: 'Order $35+ and get a free tiramisu with your meal.',
            image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&h=250&fit=crop',
            code: 'SWEETDEAL',
            discount: 'Free Item',
            validUntil: '2026-01-15'
        },
        {
            id: 'promo_003',
            title: 'Happy Hour',
            description: 'Half-price appetizers from 3-6pm daily.',
            image: 'https://images.unsplash.com/photo-1541014741259-de529411b96a?w=400&h=250&fit=crop',
            code: 'HAPPYHOUR',
            discount: '50%',
            validUntil: '2026-02-28'
        },
        {
            id: 'promo_004',
            title: 'Loyalty Bonus',
            description: 'Double points on all orders this week only!',
            image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=250&fit=crop',
            code: 'DOUBLE',
            discount: '2x Points',
            validUntil: '2026-01-07'
        }
    ],

    // Daily Spin prizes with weighted probabilities
    prizes: [
        {
            id: 'try_again',
            name: 'Try Again',
            type: 'none',
            value: 0,
            weight: 40,
            icon: '😅',
            color: '#6c757d',
            message: 'Better luck next time! Come back tomorrow for another spin.'
        },
        {
            id: 'discount_10',
            name: '10% Off',
            type: 'discount',
            value: 10,
            weight: 20,
            icon: '🎉',
            color: '#3498db',
            message: 'You won 10% off your next order! Use code: SPIN10'
        },
        {
            id: 'bonus_50',
            name: '50 Bonus Points',
            type: 'points',
            value: 50,
            weight: 15,
            icon: '⭐',
            color: '#27ae60',
            message: '50 bonus points have been added to your account!'
        },
        {
            id: 'double_points',
            name: 'Double Points',
            type: 'multiplier',
            value: 2,
            weight: 10,
            icon: '✨',
            color: '#9b59b6',
            message: 'Your next order will earn DOUBLE points!'
        },
        {
            id: 'free_drink',
            name: 'Free Drink',
            type: 'freeItem',
            value: 'drink',
            weight: 10,
            icon: '🥤',
            color: '#e67e22',
            message: 'Enjoy a FREE drink with your next order!'
        },
        {
            id: 'free_dessert',
            name: 'Free Dessert',
            type: 'freeItem',
            value: 'dessert',
            weight: 5,
            icon: '🍰',
            color: '#f1c40f',
            message: 'Amazing! You won a FREE dessert!'
        }
    ],

    // User's earned rewards (from spins)
    rewards: [
        {
            id: 'reward_001',
            prizeId: 'discount_10',
            name: '10% Off',
            code: 'SPIN10-ABC123',
            wonAt: '2025-12-30',
            expiresAt: '2026-01-30',
            used: false
        }
    ]
};

// Export for use in portal
if (typeof window !== 'undefined') {
    window.MockData = MockData;
}
