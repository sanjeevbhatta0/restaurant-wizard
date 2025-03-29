export const facebookService = {
  // Initialize Facebook login status
  initFacebookLogin() {
    return new Promise((resolve) => {
      window.FB.getLoginStatus((response) => {
        resolve(response);
      });
    });
  },

  // Handle Facebook login
  login() {
    return new Promise((resolve, reject) => {
      window.FB.login((response) => {
        if (response.status === 'connected') {
          resolve(response);
        } else {
          reject('User cancelled login or did not fully authorize.');
        }
      }, {
        scope: 'pages_show_list,pages_manage_posts,pages_read_engagement',
        return_scopes: true
      });
    });
  },

  // Get user's Facebook pages
  getPages() {
    return new Promise((resolve, reject) => {
      window.FB.api('/me/accounts', (response) => {
        if (response && !response.error) {
          resolve(response.data);
        } else {
          reject(new Error(response.error.message));
        }
      });
    });
  },

  // Post to a Facebook page
  postToPage(pageId, pageAccessToken, message, imageUrl = null) {
    return new Promise((resolve, reject) => {
      const postData = {
        message: message,
      };

      if (imageUrl) {
        // If there's an image, post it with the message
        window.FB.api(
          `/${pageId}/photos`,
          'POST',
          {
            url: imageUrl,
            caption: message,
            access_token: pageAccessToken
          },
          (response) => {
            if (response && !response.error) {
              resolve(response);
            } else {
              reject(new Error(response.error.message));
            }
          }
        );
      } else {
        // Text-only post
        window.FB.api(
          `/${pageId}/feed`,
          'POST',
          {
            ...postData,
            access_token: pageAccessToken
          },
          (response) => {
            if (response && !response.error) {
              resolve(response);
            } else {
              reject(new Error(response.error.message));
            }
          }
        );
      }
    });
  }
}; 