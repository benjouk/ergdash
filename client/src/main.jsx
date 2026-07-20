import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SyncProvider } from './context/SyncContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { UnitsProvider } from './context/UnitsContext.jsx';
import { TimeRangeProvider } from './context/TimeRangeContext.jsx';
import { PrefsProvider } from './context/PrefsContext.jsx';
import App from './App.jsx';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

// No-op on insecure origins (plain LAN-IP HTTP) and in the demo build.
// autoUpdate: a redeployed app replaces the worker on the next visit.
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <SyncProvider>
              <UnitsProvider>
                <PrefsProvider>
                  <TimeRangeProvider>
                    <App />
                  </TimeRangeProvider>
                </PrefsProvider>
              </UnitsProvider>
            </SyncProvider>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
