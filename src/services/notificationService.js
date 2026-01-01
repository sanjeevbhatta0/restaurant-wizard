/**
 * Notification Service for Restaurant Wizard
 * Handles browser notifications and audio alerts for order status changes
 * Uses Web Audio API for reliable cross-browser sound generation
 * Includes vibration support for mobile devices
 */

// Audio context for generating sounds
let audioContext = null;

// Vibration patterns (in milliseconds: vibrate, pause, vibrate, pause, ...)
const VIBRATION_PATTERNS = {
  // Kitchen: Strong urgent vibration
  newOrder: [200, 100, 200, 100, 400],
  
  // Server: Medium alert
  orderPreparing: [150, 100, 150],
  
  // Server: Strong urgent - order ready!
  orderReady: [300, 100, 300, 100, 300, 100, 500],
  
  // Payments: Short confirmation
  orderServed: [200, 100, 200],
  
  // Critical: Continuous for urgent attention (will repeat)
  critical: [500, 200, 500, 200, 500, 200, 500]
};

// Sound configurations (frequency patterns for different notifications)
const SOUND_CONFIGS = {
  // Kitchen: Urgent triple beep - high pitch, attention-grabbing
  newOrder: {
    pattern: [
      { freq: 880, duration: 150, pause: 100 },
      { freq: 880, duration: 150, pause: 100 },
      { freq: 1100, duration: 300, pause: 0 }
    ],
    volume: 0.5,
    critical: true
  },
  
  // Server: Double tone - medium pitch, informative
  orderPreparing: {
    pattern: [
      { freq: 523, duration: 200, pause: 150 },
      { freq: 659, duration: 200, pause: 0 }
    ],
    volume: 0.4,
    critical: false
  },
  
  // Server: Ascending chime - pleasant, ready signal (CRITICAL for servers!)
  orderReady: {
    pattern: [
      { freq: 523, duration: 150, pause: 50 },
      { freq: 659, duration: 150, pause: 50 },
      { freq: 784, duration: 150, pause: 50 },
      { freq: 1047, duration: 300, pause: 0 }
    ],
    volume: 0.6,
    critical: true
  },
  
  // Payments: Cash register sound - descending tone
  orderServed: {
    pattern: [
      { freq: 1047, duration: 100, pause: 50 },
      { freq: 784, duration: 100, pause: 50 },
      { freq: 659, duration: 100, pause: 50 },
      { freq: 523, duration: 200, pause: 0 }
    ],
    volume: 0.4,
    critical: true
  }
};

// Notification titles and icons
const NOTIFICATION_CONFIG = {
  newOrder: {
    title: '🍳 New Order!',
    icon: '/logo192.png',
    requireInteraction: true,
    tag: 'new-order'
  },
  orderPreparing: {
    title: '👨‍🍳 Order Being Prepared',
    icon: '/logo192.png',
    requireInteraction: false,
    tag: 'order-preparing'
  },
  orderReady: {
    title: '✅ Order Ready!',
    icon: '/logo192.png',
    requireInteraction: true,
    tag: 'order-ready'
  },
  orderServed: {
    title: '💳 Order Served - Payment Due',
    icon: '/logo192.png',
    requireInteraction: true,
    tag: 'order-served'
  }
};

// Track notification permission status
let notificationPermission = 'default';

// Track if audio is unlocked (requires user interaction first)
let audioUnlocked = false;

/**
 * Initialize Audio Context (must be called after user interaction)
 */
const initAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  // Resume if suspended (browsers require user interaction)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
};

/**
 * Request notification permission from the browser
 */
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    notificationPermission = permission;
    console.log('Notification permission:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return false;
  }
};

/**
 * Check if notifications are enabled
 */
export const areNotificationsEnabled = () => {
  return notificationPermission === 'granted' || 
         (typeof Notification !== 'undefined' && Notification.permission === 'granted');
};

/**
 * Unlock audio (call this on first user interaction)
 */
export const unlockAudio = () => {
  if (audioUnlocked) return;
  
  try {
    initAudioContext();
    
    // Play a silent sound to unlock audio
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // Silent
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.001);
    
    audioUnlocked = true;
    console.log('Audio unlocked');
  } catch (error) {
    console.warn('Could not unlock audio:', error);
  }
};

/**
 * Play a tone with Web Audio API
 */
const playTone = (frequency, duration, volume = 0.3) => {
  return new Promise((resolve) => {
    try {
      const ctx = initAudioContext();
      
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      
      // Envelope for smooth sound
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(volume * 0.7, ctx.currentTime + duration / 1000 - 0.05);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration / 1000);
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration / 1000);
      
      setTimeout(resolve, duration);
    } catch (error) {
      console.warn('Could not play tone:', error);
      resolve();
    }
  });
};

/**
 * Play a notification sound pattern
 */
export const playSound = async (type) => {
  const config = SOUND_CONFIGS[type];
  
  if (!config) {
    console.warn('Unknown notification sound type:', type);
    return;
  }
  
  // Trigger vibration along with sound
  if (config.critical) {
    vibrateCritical();
  } else {
    vibrate(type);
  }
  
  try {
    for (const note of config.pattern) {
      await playTone(note.freq, note.duration, config.volume);
      if (note.pause > 0) {
        await new Promise(resolve => setTimeout(resolve, note.pause));
      }
    }
    
    // For critical notifications, play the sound again after a delay
    if (config.critical) {
      setTimeout(async () => {
        for (const note of config.pattern) {
          await playTone(note.freq, note.duration, config.volume * 0.8);
          if (note.pause > 0) {
            await new Promise(resolve => setTimeout(resolve, note.pause));
          }
        }
      }, 2000);
    }
  } catch (error) {
    console.warn('Could not play notification sound:', error.message);
  }
};

/**
 * Preload audio - initializes audio context
 */
export const preloadAudio = () => {
  // Just initialize the audio context
  // Actual sounds are generated on-the-fly
  try {
    initAudioContext();
  } catch (e) {
    console.log('Audio context will be initialized on first user interaction');
  }
};

/**
 * Check if vibration is supported
 */
export const isVibrationSupported = () => {
  return 'vibrate' in navigator;
};

/**
 * Trigger device vibration
 */
export const vibrate = (type) => {
  if (!isVibrationSupported()) {
    console.log('Vibration not supported on this device');
    return false;
  }
  
  const pattern = VIBRATION_PATTERNS[type];
  if (!pattern) {
    console.warn('Unknown vibration type:', type);
    return false;
  }
  
  try {
    navigator.vibrate(pattern);
    return true;
  } catch (error) {
    console.warn('Vibration failed:', error);
    return false;
  }
};

/**
 * Trigger critical vibration (repeating pattern for urgent attention)
 */
export const vibrateCritical = () => {
  if (!isVibrationSupported()) return false;
  
  // Vibrate the critical pattern
  navigator.vibrate(VIBRATION_PATTERNS.critical);
  
  // For truly critical alerts, repeat the vibration after a delay
  setTimeout(() => {
    if (isVibrationSupported()) {
      navigator.vibrate(VIBRATION_PATTERNS.critical);
    }
  }, 3000);
  
  return true;
};

/**
 * Stop any ongoing vibration
 */
export const stopVibration = () => {
  if (isVibrationSupported()) {
    navigator.vibrate(0);
  }
};

/**
 * Show a browser notification
 */
export const showNotification = (type, body, onClick) => {
  if (!areNotificationsEnabled()) {
    console.log('Notifications not enabled, skipping browser notification');
    return null;
  }

  const config = NOTIFICATION_CONFIG[type];
  if (!config) {
    console.warn('Unknown notification type:', type);
    return null;
  }

  try {
    const notification = new Notification(config.title, {
      body,
      icon: config.icon,
      requireInteraction: config.requireInteraction,
      tag: config.tag, // Prevents duplicate notifications
      silent: true // We handle sound ourselves
    });

    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }

    // Auto-close after 10 seconds if not requiring interaction
    if (!config.requireInteraction) {
      setTimeout(() => notification.close(), 10000);
    }

    return notification;
  } catch (error) {
    console.error('Error showing notification:', error);
    return null;
  }
};

/**
 * Combined notification: plays sound AND shows browser notification
 */
export const notify = async (type, body, onClick) => {
  // Play sound first (most important for attention)
  await playSound(type);
  
  // Then show browser notification
  return showNotification(type, body, onClick);
};

/**
 * Kitchen-specific notifications
 */
export const notifyKitchen = {
  newOrder: (orderNumber, orderType, source) => {
    const sourceText = source === 'website' ? 'Online' : 'POS';
    const typeText = orderType === 'pickup' ? 'Pickup' : orderType === 'delivery' ? 'Delivery' : 'Dine-In';
    return notify('newOrder', `Order #${orderNumber} (${typeText} - ${sourceText})`);
  }
};

/**
 * Server-specific notifications
 */
export const notifyServer = {
  orderPreparing: (orderNumber, tableNumber) => {
    const location = tableNumber ? `Table ${tableNumber}` : 'Online Order';
    return notify('orderPreparing', `Order #${orderNumber} is being prepared (${location})`);
  },
  orderReady: (orderNumber, tableNumber) => {
    const location = tableNumber ? `Table ${tableNumber}` : 'Online Order';
    return notify('orderReady', `Order #${orderNumber} is ready for pickup! (${location})`);
  }
};

/**
 * Payments-specific notifications
 */
export const notifyPayments = {
  orderServed: (orderNumber, tableNumber, total) => {
    const location = tableNumber ? `Table ${tableNumber}` : 'Online Order';
    const totalText = total ? ` - $${total.toFixed(2)}` : '';
    return notify('orderServed', `Order #${orderNumber} served (${location})${totalText}`);
  }
};

/**
 * Initialize notification service
 * Call this on app startup or when entering a screen that needs notifications
 */
export const initializeNotifications = async () => {
  // Request permission
  await requestNotificationPermission();
  
  // Preload audio
  preloadAudio();
  
  console.log('Notification service initialized');
  return areNotificationsEnabled();
};

export default {
  initialize: initializeNotifications,
  requestPermission: requestNotificationPermission,
  areEnabled: areNotificationsEnabled,
  unlockAudio,
  preloadAudio,
  playSound,
  showNotification,
  notify,
  vibrate,
  vibrateCritical,
  stopVibration,
  isVibrationSupported,
  kitchen: notifyKitchen,
  server: notifyServer,
  payments: notifyPayments
};
