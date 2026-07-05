import { useEffect, useId, useRef, useState } from 'react';
import styles from './Charts.module.css';

export default function ChartInfo({ children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span className={styles.infoWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.infoButton}
        aria-label="What does this chart show?"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(o => !o)}
      >
        ?
      </button>
      {open && (
        <span role="note" id={popoverId} className={styles.infoPopover}>
          {children}
        </span>
      )}
    </span>
  );
}
