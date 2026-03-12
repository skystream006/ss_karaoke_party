import React, { createContext, useContext, useEffect, useState } from 'react';

export const themes = {
  classic: {
    label: 'Classic',
    swatch: '#e94560',
    vars: {
      '--primary': '#e94560',
      '--primary-dark': '#c23152',
      '--secondary': '#0f3460',
      '--accent': '#f5a623',
      '--bg-dark': '#1a1a2e',
      '--bg-card': '#16213e',
      '--bg-surface': '#0f3460',
      '--text-primary': '#e0e0e0',
      '--text-secondary': '#a0a0b0',
      '--border': 'rgba(255,255,255,0.1)',
      '--shadow': '0 4px 20px rgba(0,0,0,0.4)',
    },
  },
  neonPurple: {
    label: 'Neon Purple',
    swatch: '#b44fff',
    vars: {
      '--primary': '#b44fff',
      '--primary-dark': '#9633e0',
      '--secondary': '#2d1b69',
      '--accent': '#ff6ec7',
      '--bg-dark': '#0e0820',
      '--bg-card': '#180f35',
      '--bg-surface': '#2d1b69',
      '--text-primary': '#f0e6ff',
      '--text-secondary': '#b89fd4',
      '--border': 'rgba(180,79,255,0.2)',
      '--shadow': '0 4px 20px rgba(100,0,200,0.4)',
    },
  },
  ocean: {
    label: 'Ocean',
    swatch: '#00c9c8',
    vars: {
      '--primary': '#00c9c8',
      '--primary-dark': '#009e9d',
      '--secondary': '#005f73',
      '--accent': '#94d2bd',
      '--bg-dark': '#001219',
      '--bg-card': '#001f2e',
      '--bg-surface': '#005f73',
      '--text-primary': '#e9f5f5',
      '--text-secondary': '#8ecfce',
      '--border': 'rgba(0,201,200,0.15)',
      '--shadow': '0 4px 20px rgba(0,80,100,0.5)',
    },
  },
  forest: {
    label: 'Forest',
    swatch: '#52b788',
    vars: {
      '--primary': '#52b788',
      '--primary-dark': '#3a8f68',
      '--secondary': '#1b4332',
      '--accent': '#d8f3dc',
      '--bg-dark': '#081c15',
      '--bg-card': '#0d2818',
      '--bg-surface': '#1b4332',
      '--text-primary': '#d8f3dc',
      '--text-secondary': '#95c9a8',
      '--border': 'rgba(82,183,136,0.15)',
      '--shadow': '0 4px 20px rgba(0,50,20,0.5)',
    },
  },
  sunset: {
    label: 'Sunset',
    swatch: '#ff6b35',
    vars: {
      '--primary': '#ff6b35',
      '--primary-dark': '#e04e18',
      '--secondary': '#5c2a00',
      '--accent': '#ffd166',
      '--bg-dark': '#1a0a00',
      '--bg-card': '#2b1200',
      '--bg-surface': '#5c2a00',
      '--text-primary': '#fff0e6',
      '--text-secondary': '#d4a07a',
      '--border': 'rgba(255,107,53,0.2)',
      '--shadow': '0 4px 20px rgba(120,40,0,0.5)',
    },
  },
  midnightGold: {
    label: 'Midnight Gold',
    swatch: '#f5c518',
    vars: {
      '--primary': '#f5c518',
      '--primary-dark': '#c9a000',
      '--secondary': '#2e2500',
      '--accent': '#ffe680',
      '--bg-dark': '#0a0800',
      '--bg-card': '#151100',
      '--bg-surface': '#2e2500',
      '--text-primary': '#fff9e6',
      '--text-secondary': '#c8b870',
      '--border': 'rgba(245,197,24,0.15)',
      '--shadow': '0 4px 20px rgba(100,80,0,0.5)',
    },
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeKey, setThemeKey] = useState(
    () => localStorage.getItem('karaokeTheme') || 'classic'
  );

  useEffect(() => {
    const theme = themes[themeKey] || themes.classic;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([prop, value]) => {
      root.style.setProperty(prop, value);
    });
    document.body.style.backgroundColor = theme.vars['--bg-dark'];
  }, [themeKey]);

  const setTheme = (key) => {
    setThemeKey(key);
    localStorage.setItem('karaokeTheme', key);
  };

  return (
    <ThemeContext.Provider value={{ themeKey, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
