import React, { useState } from 'react';
import { Form } from 'react-bootstrap';
import './PasswordInput.css';

const PasswordInput = ({ value, onChange, placeholder, required, minLength, ...props }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="password-input-wrapper">
      <Form.Control
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="password-input-field"
        {...props}
      />
      <button
        type="button"
        className="password-toggle-btn"
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
      >
        <i className={`bi bi-${showPassword ? 'eye-slash' : 'eye'}`}></i>
      </button>
    </div>
  );
};

export default PasswordInput;
