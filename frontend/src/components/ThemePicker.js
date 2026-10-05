import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import './ThemePicker.css';

export default function ThemePicker() {
  const { themeKey, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const current = themes[themeKey];

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="theme-picker-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change color theme"
        title="Change color theme"
      >
        <span
          className="theme-swatch"
          style={{ backgroundColor: current.swatch }}
        />
        <span className="theme-picker-label">Theme</span>
        <span className="theme-picker-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="theme-picker-dropdown" role="listbox" aria-label="Color themes">
          {Object.entries(themes).sort((first, second) => first[1].label.localeCompare(second[1].label, undefined, { sensitivity: 'base' })).map(([key, theme]) => (
            <li key={key}>
              <button
                className={`theme-option${themeKey === key ? ' active' : ''}`}
                onClick={() => { setTheme(key); setOpen(false); }}
                role="option"
                aria-selected={themeKey === key}
              >
                <span
                  className="theme-swatch"
                  style={{ backgroundColor: theme.swatch }}
                />
                {theme.label}
                {themeKey === key && <span className="theme-check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
