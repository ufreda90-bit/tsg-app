import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/liquid-glass.css';
import { registerSW } from 'virtual:pwa-register';
import { ThemeProvider } from './lib/useTheme';
import { initializeThemeFromStorage } from './lib/theme';

// Registra il Service Worker per PWA
registerSW({ immediate: true });

import { AuthProvider } from './context/AuthContext';

initializeThemeFromStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
