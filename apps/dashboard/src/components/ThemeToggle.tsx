import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const current = document.documentElement.dataset.theme;
  if (current === 'light' || current === 'dark') return current;
  return 'light';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* localStorage unavailable */
    }
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
    >
      {theme === 'light' ? 'Dark' : 'Light'}
    </button>
  );
}
