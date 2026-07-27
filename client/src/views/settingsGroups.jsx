import {
  Bell,
  ChevronDown,
  HardDriveDownload,
  HeartPulse,
  Palette,
  RefreshCw,
  Target,
  Wrench,
} from 'lucide-react';
import styles from './Settings.module.css';

export const SETTINGS_GROUPS = [
  { id: 'appearance', label: 'Appearance', description: 'Theme and display defaults', Icon: Palette },
  { id: 'athlete', label: 'Athlete', description: 'Profile and heart-rate zones', Icon: HeartPulse },
  { id: 'training', label: 'Training', description: 'Volume goals and targets', Icon: Target },
  { id: 'connection', label: 'Connection', description: 'Profiles and Concept2 sync', Icon: RefreshCw },
  { id: 'notifications', label: 'Notifications', description: 'Reminders and delivery channels', Icon: Bell },
  { id: 'backup', label: 'Backup', description: 'Automatic and manual backups', Icon: HardDriveDownload },
  { id: 'advanced', label: 'Advanced', description: 'Instance data and resets', Icon: Wrench },
];

// Look groups up by id rather than array position, so inserting a section
// cannot silently re-label the ones after it.
export function settingsGroup(id) {
  const group = SETTINGS_GROUPS.find(entry => entry.id === id);
  if (!group) throw new Error(`Unknown settings group: ${id}`);
  return group;
}

export function SettingsGroup({ group, active, open, onToggle, children }) {
  return (
    <section
      id={`settings-${group.id}`}
      className={`${styles.settingsGroup} ${active ? styles.settingsGroupActive : ''} ${open ? styles.settingsGroupOpen : ''}`}
    >
      <button
        type="button"
        className={styles.groupToggle}
        aria-expanded={open}
        aria-controls={`settings-${group.id}-content`}
        onClick={onToggle}
      >
        <span className={styles.groupToggleText}>
          <span className={styles.groupToggleTitle}>{group.label}</span>
          <span className={styles.groupToggleDescription}>{group.description}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" className={styles.groupToggleChevron} />
      </button>
      <div id={`settings-${group.id}-content`} className={styles.groupContent}>
        {children}
      </div>
    </section>
  );
}
