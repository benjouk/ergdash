import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_GROUPS, SettingsGroup } from './settingsGroups.jsx';

describe('settings information architecture', () => {
  it('keeps the settings areas in a focused, stable order', () => {
    expect(SETTINGS_GROUPS.map(group => group.id)).toEqual([
      'appearance',
      'athlete',
      'training',
      'connection',
      'backup',
      'advanced',
    ]);
  });

  it('renders an accessible mobile accordion control without removing its content', () => {
    const markup = renderToStaticMarkup(
      <SettingsGroup
        group={SETTINGS_GROUPS[0]}
        active
        open
        onToggle={vi.fn()}
      >
        <p>Theme controls</p>
      </SettingsGroup>
    );

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="settings-appearance-content"');
    expect(markup).toContain('Theme controls');
  });
});
