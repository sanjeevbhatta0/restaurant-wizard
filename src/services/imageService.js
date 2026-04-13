/**
 * Image optimization utilities for menu items.
 * Handles preloading, compression, and resizing.
 */

/**
 * Preload an array of image URLs into the browser cache.
 * Non-blocking — errors are silently ignored (missing images just won't be cached).
 */
export function preloadImages(urls) {
  if (!urls || urls.length === 0) return;

  urls.forEach(url => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  });
}

/**
 * Extract all image URLs from menu categories data.
 */
export function extractImageUrls(categories) {
  const urls = [];
  if (!categories) return urls;

  for (const cat of categories) {
    if (cat.items) {
      for (const item of cat.items) {
        if (item.imageUrl) {
          urls.push(item.imageUrl);
        }
      }
    }
  }
  return urls;
}

/**
 * Compress and resize an image file before upload.
 * Returns a new File object (JPEG) capped at maxDimension px and quality level.
 *
 * @param {File} file - Original image file
 * @param {Object} options
 * @param {number} options.maxWidth - Max width in px (default 800)
 * @param {number} options.maxHeight - Max height in px (default 800)
 * @param {number} options.quality - JPEG quality 0-1 (default 0.8)
 * @returns {Promise<File>} Compressed image file
 */
export function compressImage(file, options = {}) {
  const { maxWidth = 800, maxHeight = 800, quality = 0.8 } = options;

  return new Promise((resolve, reject) => {
    // Skip non-image files
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }

    const img = new Image();
    const canvas = document.createElement('canvas');
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;

        // Only resize if larger than max dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file); // fallback to original
              return;
            }

            // Only use compressed version if it's actually smaller
            if (blob.size >= file.size) {
              resolve(file);
              return;
            }

            const compressedFile = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.jpg'),
              { type: 'image/jpeg', lastModified: Date.now() }
            );
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => resolve(file); // fallback to original on error
      img.src = e.target.result;
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
