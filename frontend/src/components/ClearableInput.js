import React, { forwardRef } from 'react';
import './ClearableInput.css';

const ClearableInput = forwardRef(function ClearableInput({ style, onChange, ...props }, ref) {
  const handleClear = () => {
    onChange({ target: { value: '' } });
  };

  return (
    <div className="clearable-input-wrapper">
      <input
        {...props}
        ref={ref}
        onChange={onChange}
        style={{ ...style, paddingRight: '2.25rem' }}
      />
      {props.value ? (
        <button
          type="button"
          className="input-clear-btn"
          onClick={handleClear}
          tabIndex={-1}
          aria-label="Clear"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
});

export default ClearableInput;
