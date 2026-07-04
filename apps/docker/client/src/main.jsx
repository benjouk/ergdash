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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
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
