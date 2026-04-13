import React, { useState, useRef, useEffect } from 'react';
import './MenuItemImage.css';

/**
 * Progressive image component for menu items.
 * Shows a shimmer skeleton placeholder, then fades in the image once loaded.
 * Reusable across POS, MenuManagement, and template websites.
 */
function MenuItemImage({ src, alt, size = 70, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef(null);

  // If the image is already in browser cache, it loads synchronously —
  // check .complete on mount so we don't flash the skeleton unnecessarily.
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  if (!src || error) {
    return (
      <div
        className={`menu-img-placeholder ${className}`}
        style={{ width: size, height: size }}
      >
        <i className="bi bi-cup-straw"></i>
      </div>
    );
  }

  return (
    <div
      className={`menu-img-wrapper ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded && <div className="menu-img-skeleton" />}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`menu-img ${loaded ? 'menu-img-loaded' : 'menu-img-loading'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        loading="lazy"
      />
    </div>
  );
}

export default MenuItemImage;
