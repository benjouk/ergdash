import styles from './Eyebrow.module.css';

// Small uppercase label with a short accent rule, sits above a section or
// card title. Shared so the treatment stays identical everywhere it appears.
export default function Eyebrow({ children }) {
  return <span className={styles.eyebrow}>{children}</span>;
}
