import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkoutActions } from './Workouts.jsx';

const handlers = {
  onAdd: vi.fn(),
  onCompare: vi.fn(),
  onMenuToggle: vi.fn(),
  onImport: vi.fn(),
  onExportJson: vi.fn(),
  onExportCsv: vi.fn(),
};

function renderActions(props = {}) {
  return renderToStaticMarkup(
    <WorkoutActions
      compareMode={false}
      panel={null}
      menuOpen
      menuRef={{ current: null }}
      menuButtonRef={{ current: null }}
      {...handlers}
      {...props}
    />
  );
}

describe('workout actions', () => {
  it('keeps the primary actions visible and groups file actions in a menu', () => {
    const markup = renderActions();

    expect(markup).toContain('Add');
    expect(markup).toContain('Compare');
    expect(markup).toContain('aria-controls="workout-more-actions"');
    expect(markup).toContain('Import workouts');
    expect(markup).toContain('Export CSV');
    expect(markup).toContain('Export JSON');
  });

  it('connects disabled demo actions to the visible demo explanation', () => {
    const markup = renderActions({ demo: true });

    expect(markup).toContain('aria-describedby="workouts-demo-note"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});
