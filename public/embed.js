// Restaurant Menu Embed Script
window.RestaurantMenu = {
  init: function(config) {
    if (!config.restaurantId || !config.container) {
      console.error('RestaurantMenu: restaurantId and container are required');
      return;
    }

    // Get container element
    const container = document.getElementById(config.container);
    if (!container) {
      console.error('RestaurantMenu: container element not found');
      return;
    }

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      .restaurant-menu {
        font-family: system-ui, -apple-system, sans-serif;
        max-width: 1200px;
        margin: 0 auto;
      }
      .restaurant-menu-category {
        margin-bottom: 2rem;
      }
      .restaurant-menu-category-title {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid #eee;
      }
      .restaurant-menu-items {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1rem;
      }
      .restaurant-menu-item {
        padding: 1rem;
        border: 1px solid #eee;
        border-radius: 0.5rem;
      }
      .restaurant-menu-item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.5rem;
      }
      .restaurant-menu-item-name {
        font-weight: 600;
        margin: 0;
      }
      .restaurant-menu-item-price {
        font-weight: 600;
        color: #666;
      }
      .restaurant-menu-item-description {
        color: #666;
        font-size: 0.9rem;
        margin: 0;
      }
      .restaurant-menu-item-image {
        width: 100%;
        height: 200px;
        object-fit: cover;
        border-radius: 0.25rem;
        margin-bottom: 0.5rem;
      }
      .restaurant-menu-item-unavailable {
        opacity: 0.5;
      }
      .restaurant-menu-item-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: #fff;
        background-color: #999;
        border-radius: 0.25rem;
        margin-left: 0.5rem;
      }
      @media (max-width: 768px) {
        .restaurant-menu-items {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(styles);

    // Show loading state
    container.innerHTML = '<div class="restaurant-menu">Loading menu...</div>';

    // Fetch menu data
    fetch(`https://us-central1-restaurant-portal-6b147.cloudfunctions.net/getMenu/${config.restaurantId}`)
      .then(response => response.json())
      .then(data => {
        // Render menu
        container.innerHTML = `
          <div class="restaurant-menu">
            ${data.categories.map(category => `
              <div class="restaurant-menu-category">
                <h2 class="restaurant-menu-category-title">${category.name}</h2>
                ${category.description ? `<p class="restaurant-menu-category-description">${category.description}</p>` : ''}
                <div class="restaurant-menu-items">
                  ${category.items.map(item => `
                    <div class="restaurant-menu-item ${!item.available ? 'restaurant-menu-item-unavailable' : ''}">
                      ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" class="restaurant-menu-item-image">` : ''}
                      <div class="restaurant-menu-item-header">
                        <h3 class="restaurant-menu-item-name">
                          ${item.name}
                          ${!item.available ? '<span class="restaurant-menu-item-badge">Unavailable</span>' : ''}
                        </h3>
                        <div class="restaurant-menu-item-price">
                          ${item.discountType !== 'none' ? `
                            <span style="text-decoration: line-through; margin-right: 0.5rem;">$${item.price.toFixed(2)}</span>
                          ` : ''}
                          $${item.finalPrice.toFixed(2)}
                        </div>
                      </div>
                      ${item.description ? `<p class="restaurant-menu-item-description">${item.description}</p>` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      })
      .catch(error => {
        console.error('RestaurantMenu: Failed to load menu data', error);
        container.innerHTML = '<div class="restaurant-menu">Failed to load menu. Please try again later.</div>';
      });
  }
}; 