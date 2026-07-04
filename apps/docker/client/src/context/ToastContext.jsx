import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import ToastStack from '../components/Toast/ToastStack.jsx';

const ToastContext = createContext(null);
const TOAST_TIMEOUT_MS = 4000;
const MAX_TOASTS = 4;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((type, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setToasts(current => [
      ...current,
      { id, type, message },
    ].slice(-MAX_TOASTS));

    window.setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS);
  }, [dismiss]);

  const value = useMemo(() => ({
    success: (message) => addToast('success', message),
    error: (message) => addToast('error', message),
    info: (message) => addToast('info', message),
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
