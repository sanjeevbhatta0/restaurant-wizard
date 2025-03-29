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
        scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,pages_show_list',
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
  },

  getInstagramAccounts: () => {
    return new Promise((resolve, reject) => {
      window.FB.api('/me/accounts', async (response) => {
        if (response.error) {
          reject(response.error);
          return;
        }

        // Get Instagram account ID for each page
        const pagesWithInstagram = await Promise.all(
          response.data.map(async (page) => {
            try {
              const instagramResponse = await new Promise((resolve) => {
                window.FB.api(
                  `/${page.id}?fields=instagram_business_account`,
                  (response) => resolve(response)
                );
              });
              
              return {
                ...page,
                instagram_account: instagramResponse.instagram_business_account
              };
            } catch (error) {
              console.error(`Error fetching Instagram account for page ${page.name}:`, error);
              return page;
            }
          })
        );

        resolve(pagesWithInstagram.filter(page => page.instagram_account));
      });
    });
  },

  postToInstagram: (instagramAccountId, imageUrl, caption) => {
    return new Promise(async (resolve, reject) => {
      try {
        // First, create a media container
        const createMediaResponse = await new Promise((resolve) => {
          window.FB.api(
            `/${instagramAccountId}/media`,
            'POST',
            {
              image_url: imageUrl,
              caption: caption
            },
            (response) => resolve(response)
          );
        });

        if (!createMediaResponse.id) {
          throw new Error('Failed to create media container');
        }

        // Then publish the container
        const publishResponse = await new Promise((resolve) => {
          window.FB.api(
            `/${instagramAccountId}/media_publish`,
            'POST',
            {
              creation_id: createMediaResponse.id
            },
            (response) => resolve(response)
          );
        });

        resolve(publishResponse);
      } catch (error) {
        reject(error);
      }
    });
  }
}; 