import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import { ChartSkeleton } from '../components/Skeleton/Skeleton.jsx';
import ChartEmpty from '../components/Charts/ChartEmpty.jsx';
import { useChartData } from '../components/Charts/useChartData.js';
import EfficiencyChart from '../components/Charts/EfficiencyChart.jsx';
import HrDriftChart from '../components/Charts/HrDriftChart.jsx';
import DpsTrendChart from '../components/Charts/DpsTrendChart.jsx';
import StrokeQualityCard from '../components/Charts/StrokeQualityCard.jsx';
import DragFactorChart from '../components/Charts/DragFactorChart.jsx';
import { buildTechniqueSummaries } from './progressModel.js';
import styles from './Progress.module.css';

const METRICS = [
  { id: 'efficiency', label: 'Efficiency', description: 'Power produced per heartbeat', Component: EfficiencyChart, betterWhenUp: true, stableWithin: 0.02 },
  { id: 'hr_drift', label: 'HR drift', description: 'Aerobic control through the row', Component: HrDriftChart, betterWhenUp: false, stableWithin: 0.5 },
  { id: 'dps', label: 'Distance per stroke', description: 'Length produced by each stroke', Component: DpsTrendChart, betterWhenUp: true, stableWithin: 0.08 },
  { id: 'stroke_quality', label: 'Stroke quality', description: 'Rate discipline and consistency', Component: StrokeQualityCard, betterWhenUp: true, stableWithin: 2 },
  { id: 'drag', label: 'Drag factor', description: 'Setup consistency between rows', Component: DragFactorChart, betterWhenUp: null },
];

export default function ProgressTechnique() {
  const { from, to } = useTimeRange();
  const [selected, setSelected] = useState('efficiency');
  const { data, loading, error, retry } = useChartData(async () => {
    const base = { period: 'all', tag: 'endurance' };
    if (from) base.from = from;
    if (to) base.to = to;

    const [efficiency, hrDrift, dps, discipline, consistency, drag] = await Promise.all([
      api.getTrends({ ...base, metric: 'watts_per_beat' }).then(result => result.watts_per_beat_trend || []),
      api.getTrends({ ...base, metric: 'hr_drift' }).then(result => result.hr_drift_trend || []),
      api.getTrends({ ...base, metric: 'dps' }).then(result => result.dps_trend || []),
      api.getTrends({ ...base, metric: 'rate_discipline' }).then(result => result.rate_discipline_trend || []),
      api.getTrends({ ...base, metric: 'consistency' }).then(result => result.consistency_trend || []),
      api.getTrends({ ...base, metric: 'drag' }).then(result => result.drag_trend || []),
    ]);
    return { efficiency, hr_drift: hrDrift, dps, discipline, consistency, drag };
  }, [from, to]);

  const summaries = useMemo(() => buildTechniqueSummaries(data), [data]);
  const firstAvailable = METRICS.find(metric => summaries[metric.id]?.available)?.id;

  useEffect(() => {
    if (firstAvailable && !summaries[selected]?.available) setSelected(firstAvailable);
  }, [firstAvailable, selected, summaries]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Technique" message="Couldn't load technique trends." error onRetry={retry} />;

  const active = METRICS.find(metric => metric.id === selected) || METRICS[0];
  const ActiveChart = active.Component;

  return (
    <div className={styles.detailSections}>
      <section className={styles.detailSection} aria-labelledby="technique-heading">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Steady sessions only</span><h3 id="technique-heading">One technique signal at a time</h3></div>
          <span>Like-for-like rows reduce noise. Efficiency and HR drift need heart-rate data.</span>
        </div>

        <div className={styles.techniqueLayout}>
          <div className={styles.techniqueScorecard} aria-label="Technique signals">
            {METRICS.map(metric => {
              const summary = summaries[metric.id] || { available: false };
              return (
                <button
                  key={metric.id}
                  type="button"
                  className={`${styles.techniqueRow} ${selected === metric.id ? styles.techniqueRowActive : ''}`}
                  onClick={() => setSelected(metric.id)}
                  disabled={!summary.available}
                  aria-pressed={selected === metric.id}
                >
                  <span><strong>{metric.label}</strong><small>{metric.description}</small></span>
                  <span className={styles.techniqueReading}>
                    <strong>{formatTechniqueValue(metric.id, summary)}</strong>
                    <small>{formatTechniqueDelta(metric, summary)}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className={styles.techniqueChart}>
            <ActiveChart tag="endurance" />
          </div>
        </div>
      </section>
    </div>
  );
}

export function formatTechniqueValue(id, summary) {
  if (!summary.available) return 'Need more data';
  if (id === 'efficiency') return `${summary.value.toFixed(2)} w/beat`;
  if (id === 'hr_drift') return `${summary.value > 0 ? '+' : ''}${summary.value.toFixed(1)}%`;
  if (id === 'dps') return `${summary.value.toFixed(2)} m/stroke`;
  if (id === 'stroke_quality') {
    const first = summary.value == null ? '—' : summary.value.toFixed(0);
    const second = summary.secondaryValue == null ? '—' : summary.secondaryValue.toFixed(0);
    return `${first} / ${second}`;
  }
  return summary.value.toFixed(0);
}

export function formatTechniqueDelta(metric, summary) {
  if (!summary.available) {
    return metric.id === 'efficiency' || metric.id === 'hr_drift'
      ? 'Heart-rate data required'
      : 'Log at least 3 comparable rows';
  }
  if (metric.betterWhenUp == null || summary.delta == null) return `${summary.count} rows in range`;
  const improving = metric.betterWhenUp ? summary.delta > 0 : summary.delta < 0;
  const stable = Math.abs(summary.delta) < (metric.stableWithin ?? 0.005);
  return stable ? `Stable · ${summary.count} rows` : `${improving ? 'Improving' : 'Slightly down'} · ${summary.count} rows`;
}
