import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

const twitterService = {
  /**
   * Initiate Twitter/X OAuth 2.0 flow
   * Opens a popup window for Twitter authorization
   */
  async connect() {
    try {
      const initiateAuth = httpsCallable(functions, 'initiateTwitterAuth');
      const result = await initiateAuth();

      if (!result.data.success) {
        throw new Error(result.data.message || 'Failed to initiate Twitter authentication');
      }

      // Open Twitter auth in a popup window
      const authUrl = result.data.authUrl;
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'twitter-auth',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
      );

      // Return a promise that resolves when the popup redirects back
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          try {
            if (popup.closed) {
              clearInterval(checkInterval);
              // Check if connection was successful by getting status
              setTimeout(async () => {
                try {
                  const status = await twitterService.getStatus();
                  if (status.connected) {
                    resolve(status);
                  } else {
                    reject(new Error('Twitter connection was cancelled or failed'));
                  }
                } catch (err) {
                  reject(err);
                }
              }, 1000);
            }

            // Check if popup URL contains our callback
            if (popup.location && popup.location.href) {
              const url = new URL(popup.location.href);
              if (url.searchParams.get('twitter_connected') === 'true') {
                clearInterval(checkInterval);
                popup.close();
                resolve({ connected: true });
              } else if (url.searchParams.get('twitter_error')) {
                clearInterval(checkInterval);
                popup.close();
                reject(new Error(url.searchParams.get('twitter_error')));
              }
            }
          } catch (e) {
            // Cross-origin errors are expected while on Twitter's domain
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!popup.closed) popup.close();
          reject(new Error('Twitter authentication timed out'));
        }, 5 * 60 * 1000);
      });
    } catch (error) {
      console.error('Twitter connect error:', error);
      throw error;
    }
  },

  /**
   * Disconnect Twitter/X account
   */
  async disconnect() {
    const disconnectFn = httpsCallable(functions, 'disconnectTwitter');
    const result = await disconnectFn();
    return result.data;
  },

  /**
   * Get Twitter/X connection status
   */
  async getStatus() {
    const statusFn = httpsCallable(functions, 'getTwitterStatus');
    const result = await statusFn();
    return result.data;
  },

  /**
   * Post a tweet
   * @param {string} content - Tweet text (max 280 chars)
   * @param {string|null} imageUrl - Optional image URL
   */
  async postTweet(content, imageUrl = null) {
    const postFn = httpsCallable(functions, 'postTweet');
    const result = await postFn({ content, imageUrl });
    return result.data;
  }
};

export default twitterService;
