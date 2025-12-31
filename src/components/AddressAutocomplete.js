import React, { useState, useEffect, useRef } from 'react';
import { Form } from 'react-bootstrap';
import './AddressAutocomplete.css';

const AddressAutocomplete = ({ value, onChange, onSelect, placeholder = "Start typing your address..." }) => {
  const [inputValue, setInputValue] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    // Close suggestions when clicking outside
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Debounced search function
  const searchAddresses = async (query) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoading(true);
    try {
      // Using OpenStreetMap Nominatim API (free and open-source)
      // Limiting to US addresses
      // Note: Nominatim requires a valid User-Agent header per their usage policy
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `format=json&` +
        `q=${encodeURIComponent(query)}&` +
        `countrycodes=us&` +
        `addressdetails=1&` +
        `limit=5`,
        {
          headers: {
            'User-Agent': 'RestaurantWizard/1.0' // Required by Nominatim usage policy
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch addresses');
      }

      const data = await response.json();
      
      // Format the suggestions
      const formattedSuggestions = data.map(item => ({
        display: item.display_name,
        address: {
          street: item.address?.road || '',
          houseNumber: item.address?.house_number || '',
          city: item.address?.city || item.address?.town || item.address?.village || '',
          state: item.address?.state || '',
          zipCode: item.address?.postcode || '',
          country: item.address?.country || 'United States',
          fullAddress: item.display_name
        },
        lat: item.lat,
        lon: item.lon
      }));

      setSuggestions(formattedSuggestions);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error fetching addresses:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange?.(newValue);

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce the API call
    debounceTimerRef.current = setTimeout(() => {
      searchAddresses(newValue);
    }, 300);
  };

  const handleSuggestionClick = (suggestion) => {
    const fullAddress = suggestion.address.fullAddress;
    setInputValue(fullAddress);
    setShowSuggestions(false);
    setSuggestions([]);
    onChange?.(fullAddress);
    onSelect?.(suggestion.address);
  };

  const handleInputFocus = () => {
    if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  return (
    <div ref={wrapperRef} className="address-autocomplete-wrapper">
      <Form.Control
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && (
        <div className="address-autocomplete-loading">
          <small className="text-muted">Searching addresses...</small>
        </div>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div className="address-autocomplete-suggestions">
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className="address-suggestion-item"
              onClick={() => handleSuggestionClick(suggestion)}
            >
              <div className="address-suggestion-main">{suggestion.display}</div>
              {suggestion.address.city && suggestion.address.state && (
                <div className="address-suggestion-details">
                  {suggestion.address.city}, {suggestion.address.state} {suggestion.address.zipCode}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AddressAutocomplete;
