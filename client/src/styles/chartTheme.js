// Centralized Recharts theming — all colors resolve through CSS variables so
// light/dark themes apply without re-rendering charts.

export const AXIS_TICK = { fontSize: 11, fill: 'var(--ink-3)', fontFamily: 'var(--font-mono)' };

export const AXIS_LINE = { stroke: 'var(--chart-grid)' };

export const GRID_PROPS = { stroke: 'var(--chart-grid)', strokeDasharray: '3 3', vertical: false };

export const REF_LINE = { stroke: 'var(--chart-ref)', strokeDasharray: '3 3' };

export const SERIES = {
  primary: 'var(--chart-1)',
  primaryBg: 'var(--accent-bg)',
  secondary: 'var(--chart-2)',
  secondaryBg: 'var(--accent-2-bg)',
  tertiary: 'var(--chart-3)',
  tertiaryBg: 'var(--accent-3-bg)',
  hr: 'var(--hr)',
  hrBg: 'var(--hr-bg)',
};

export const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
};

export const TOOLTIP_LABEL_STYLE = {
  color: 'var(--ink-2)',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  marginBottom: 4,
};

// Spread onto Recharts <Tooltip {...TOOLTIP_PROPS} /> — Recharts identifies
// children by element type, so a wrapper component would not be detected.
export const TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
};

// Gradient ids shared by <defs> blocks; keep unique per series to avoid collisions.
export const GRADIENTS = {
  primary: 'rd-grad-primary',
  secondary: 'rd-grad-secondary',
  tertiary: 'rd-grad-tertiary',
};
