import { NavLink } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, List, Settings2 } from 'lucide-react';
import styles from './BottomNav.module.css';

const ITEMS = [
  { to: '/', end: true, label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/progress', label: 'Progress', Icon: TrendingUp },
  { to: '/workouts', label: 'Workouts', Icon: List },
  { to: '/settings', label: 'Settings', Icon: Settings2 },
];

export default function BottomNav() {
  return (
    <nav className={styles.bottomNav} aria-label="Primary">
      {ITEMS.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
        >
          <Icon size={20} aria-hidden="true" />
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
