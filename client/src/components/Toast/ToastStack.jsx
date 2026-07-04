import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export default function ToastStack({ toasts, onDismiss }) {
  return (
    <div className={styles.stack} aria-live="polite" aria-atomic="false">
      {toasts.map(toast => {
        const Icon = ICONS[toast.type] || Info;
        return (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.type] || ''}`}>
            <Icon size={18} className={styles.icon} aria-hidden="true" />
            <div className={styles.message}>{toast.message}</div>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
