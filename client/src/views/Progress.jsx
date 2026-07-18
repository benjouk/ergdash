import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { CHART_GROUPS, CHART_REGISTRY, DEFAULT_LAYOUT } from './progressChartRegistry.js';
import { buildSections, mergeLayout, toggleHidden } from './progressLayout.js';
import styles from './Progress.module.css';

const REGISTRY_BY_ID = new Map(CHART_REGISTRY.map(chart => [chart.id, chart]));

export default function Progress() {
  const toast = useToast();
  const [layout, setLayout] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const hasUserEdited = useRef(false);
  const shouldPersist = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let active = true;

    api.getSettings()
      .then((settings) => {
        if (!active || hasUserEdited.current) {
          return;
        }
        setLayout(mergeLayout(settings.progress_layout, CHART_REGISTRY));
      })
      .catch(() => {
        if (!active || hasUserEdited.current) {
          return;
        }
        setLayout(DEFAULT_LAYOUT);
        toast.error('Unable to load progress layout');
      });

    return () => {
      active = false;
    };
  }, [toast]);

  useEffect(() => {
    if (!layout || !shouldPersist.current) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      api.updateSettings({ progress_layout: JSON.stringify(layout) })
        .catch(() => toast.error('Unable to save progress layout'));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [layout, toast]);

  const sections = useMemo(() => (
    layout && !isEditing ? buildSections(layout, CHART_REGISTRY, CHART_GROUPS) : []
  ), [layout, isEditing]);

  const editCharts = useMemo(() => {
    if (!layout || !isEditing) {
      return [];
    }
    return layout.charts
      .filter(chart => REGISTRY_BY_ID.has(chart.id))
      .map(chart => ({ ...REGISTRY_BY_ID.get(chart.id), hidden: Boolean(chart.hidden) }));
  }, [layout, isEditing]);

  const activeChart = activeId ? editCharts.find(chart => chart.id === activeId) : null;

  function updateLayout(updater) {
    hasUserEdited.current = true;
    shouldPersist.current = true;
    setLayout(current => updater(current || DEFAULT_LAYOUT));
  }

  function handleToggleHidden(id) {
    updateLayout(current => toggleHidden(current, id));
  }

  function handleReset() {
    updateLayout(() => DEFAULT_LAYOUT);
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null);
    if (!over || active.id === over.id) {
      return;
    }

    updateLayout((current) => {
      const oldIndex = current.charts.findIndex(chart => chart.id === active.id);
      const newIndex = current.charts.findIndex(chart => chart.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }
      return { ...current, charts: arrayMove(current.charts, oldIndex, newIndex) };
    });
  }

  function renderRow(row) {
    if (row.length === 1 && row[0].width === 'full') {
      const Chart = row[0].component;
      return <Chart key={row[0].id} />;
    }

    return (
      <div key={row.map(chart => chart.id).join('-')} className={styles.secondaryGrid}>
        {row.map((chart) => {
          const Chart = chart.component;
          return <Chart key={chart.id} />;
        })}
      </div>
    );
  }

  return (
    <div className={styles.progress}>
      <div className={styles.header}>
        <h2 className={styles.title}>Progress</h2>
        <div className={styles.actions}>
          {isEditing && (
            <button type="button" className={styles.button} onClick={handleReset}>
              Reset
            </button>
          )}
          <button
            type="button"
            className={`${styles.button} ${!isEditing ? styles.buttonWithIcon : ''}`}
            onClick={() => setIsEditing(current => !current)}
          >
            {isEditing ? (
              'Done'
            ) : (
              <>
                <SlidersHorizontal size={16} aria-hidden="true" />
                Edit layout
              </>
            )}
          </button>
        </div>
      </div>

      {isEditing ? (
        <>
          <p className={styles.editHint}>
            Drag cards to reorder within their section. Use the eye to show or hide a chart.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={({ active }) => setActiveId(active.id)}
            onDragCancel={() => setActiveId(null)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={editCharts.map(chart => chart.id)} strategy={rectSortingStrategy}>
              <div className={styles.editGrid}>
                {editCharts.map(chart => (
                  <SortableChartCard
                    key={chart.id}
                    chart={chart}
                    onToggleHidden={handleToggleHidden}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
              {activeChart ? <ChartCardGhost chart={activeChart} /> : null}
            </DragOverlay>
          </DndContext>
        </>
      ) : (
        sections.map(section => (
          <section key={section.id} className={styles.chartSection} aria-label={section.label}>
            <h3 className={styles.sectionTitle}>{section.label}</h3>
            {section.rows.map(renderRow)}
          </section>
        ))
      )}
    </div>
  );
}

function SortableChartCard({ chart, onToggleHidden }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chart.id });

  const visibilityLabel = chart.hidden ? `Show ${chart.title}` : `Hide ${chart.title}`;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        styles.editCard,
        chart.hidden ? styles.editCardHidden : '',
        isDragging ? styles.editCardDragging : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={styles.editToolbar}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={styles.dragHandleButton}
          aria-label={`Reorder ${chart.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <span className={styles.editCardTitle}>{chart.title}</span>
        <span className={styles.widthBadge}>{groupLabel(chart.group)}</span>
        {chart.width === 'full' && <span className={styles.widthBadge}>Full width</span>}
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => onToggleHidden(chart.id)}
          title={visibilityLabel}
          aria-label={visibilityLabel}
        >
          {chart.hidden ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      <ChartMiniature chart={chart} />
    </div>
  );
}

function groupLabel(groupId) {
  return CHART_GROUPS.find(group => group.id === groupId)?.label || 'Other';
}

function ChartCardGhost({ chart }) {
  return (
    <div className={`${styles.editCard} ${styles.editCardGhost}`}>
      <div className={styles.editToolbar}>
        <span className={`${styles.dragHandleButton} ${styles.dragHandleStatic}`}>
          <GripVertical size={16} aria-hidden="true" />
        </span>
        <span className={styles.editCardTitle}>{chart.title}</span>
        <span className={styles.widthBadge}>{groupLabel(chart.group)}</span>
        {chart.width === 'full' && <span className={styles.widthBadge}>Full width</span>}
      </div>
    </div>
  );
}

function ChartMiniature({ chart }) {
  const Chart = chart.component;

  if (chart.hidden) {
    return <div className={`${styles.editPreviewViewport} ${styles.editPreviewEmpty}`}>Hidden</div>;
  }

  return (
    <div className={styles.editPreviewViewport} aria-hidden="true">
      <div className={styles.editPreviewScale}>
        <Chart />
      </div>
    </div>
  );
}
