import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { useUnits } from '../../context/UnitsContext.jsx';
import styles from './ComparisonOverlay.module.css';

export default function ComparisonOverlay({ workout1, workout2, onBack }) {
  const { formatPace } = useUnits();

  const strokeData1 = useMemo(() => buildStrokeSeries(workout1?.strokes), [workout1?.strokes]);
  const strokeData2 = useMemo(() => buildStrokeSeries(workout2?.strokes), [workout2?.strokes]);
  const comparisonData = useMemo(
    () => buildComparisonSeries(strokeData1, strokeData2, workout1?.distance, workout2?.distance),
    [strokeData1, strokeData2, workout1?.distance, workout2?.distance]
  );

  const stats1 = getComparisonStats(workout1);
  const stats2 = getComparisonStats(workout2);
  const deltas = computeDeltas(stats1, stats2);

  // Calculate dynamic Y-axis padding based on pace range to scale for fast/slow rowers
  const yAxisPadding = useMemo(() => {
    const maxPace = Math.max(workout1?.pace_ms || 0, workout2?.pace_ms || 0);
    return Math.max(1000, Math.round(maxPace * 0.1));
  }, [workout1?.pace_ms, workout2?.pace_ms]);

  return (
    <div className={styles.comparison}>
      <div className={styles.topbar}>
        <button onClick={onBack} className={styles.backButton} aria-label="Back to session">
          <ArrowLeft size={15} /> Back
        </button>
      </div>

      <header className={styles.header}>
        <h2 className={styles.headerTitle}>Session Comparison</h2>
      </header>

      {/* Dual Header with Stats */}
      <div className={styles.dualHeader}>
        <div className={styles.sessionColumn}>
          <div className={styles.columnTitle}>{formatDate(new Date(workout1.date))}</div>
          <div className={styles.columnMeta}>{formatTime(workout1.time_ms)}</div>
          <div className={styles.statsGrid}>
            {[
              { label: 'Pace', value: formatPace(workout1.pace_ms), delta: deltas.pace },
              { label: 'Rate', value: formatRate(workout1.stroke_rate), unit: 'spm', delta: deltas.rate },
              { label: 'HR', value: formatNumber(workout1.heart_rate_avg), unit: 'bpm', delta: deltas.heartRate },
            ].map(stat => (
              <div key={stat.label} className={styles.statCell}>
                <div className={styles.statLabel}>{stat.label}</div>
                <div className={styles.statValue}>{stat.value}{stat.unit && <span className={styles.statUnit}>{stat.unit}</span>}</div>
                {stat.delta && <div className={`${styles.statDelta} ${stat.delta > 0 ? styles.deltaPositive : styles.deltaNegative}`}>{stat.delta > 0 ? '+' : ''}{stat.delta}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.sessionColumn}>
          <div className={styles.columnTitle}>{formatDate(new Date(workout2.date))}</div>
          <div className={styles.columnMeta}>{formatTime(workout2.time_ms)}</div>
          <div className={styles.statsGrid}>
            {[
              { label: 'Pace', value: formatPace(workout2.pace_ms) },
              { label: 'Rate', value: formatRate(workout2.stroke_rate), unit: 'spm' },
              { label: 'HR', value: formatNumber(workout2.heart_rate_avg), unit: 'bpm' },
            ].map(stat => (
              <div key={stat.label} className={styles.statCell}>
                <div className={styles.statLabel}>{stat.label}</div>
                <div className={styles.statValue}>{stat.value}{stat.unit && <span className={styles.statUnit}>{stat.unit}</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overlaid Pace Chart */}
      {comparisonData.length > 0 && (
        <div className={styles.card}>
          <div className={styles.chartLabel}>Pace Overlay</div>
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={comparisonData}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="diff-green" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="diff-red" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--hot)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--hot)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
                <XAxis
                  dataKey="distance"
                  tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
                  tickFormatter={v => `${v}m`}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  reversed
                  tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
                  tickFormatter={v => formatPace(v)}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                  domain={[`dataMin - ${yAxisPadding}`, `dataMax + ${yAxisPadding}`]}
                />
                <Tooltip content={<ComparisonTooltip formatPace={formatPace} />} />

                {/* Session 1 line */}
                <Line
                  type="monotone"
                  dataKey="pace_ms_1"
                  stroke="var(--accent-2)"
                  strokeWidth={2}
                  dot={false}
                  name="Session 1"
                />

                {/* Session 2 line */}
                <Line
                  type="monotone"
                  dataKey="pace_ms_2"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                  name="Session 2"
                />

                {/* Difference ribbon */}
                {comparisonData.some(d => d.diff_faster_than_1) && (
                  <Area
                    type="monotone"
                    dataKey="pace_ms_2"
                    fill="url(#diff-green)"
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
                {comparisonData.some(d => d.diff_slower_than_1) && (
                  <Area
                    type="monotone"
                    dataKey="pace_ms_2"
                    fill="url(#diff-red)"
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Splits Table */}
      {(workout1.intervals?.length > 0 || strokeData1.length > 0) && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Splits Comparison</div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.splitsTable}>
              <thead>
                <tr>
                  <th>Split</th>
                  <th colSpan="3">Session 1</th>
                  <th colSpan="3">Session 2</th>
                </tr>
                <tr>
                  <th></th>
                  <th>Pace</th>
                  <th>Rate</th>
                  <th>HR</th>
                  <th>Pace</th>
                  <th>Rate</th>
                  <th>HR</th>
                </tr>
              </thead>
              <tbody>
                {buildSplitRows(workout1, workout2).map((row, idx) => (
                  <tr key={idx}>
                    <td className={styles.splitLabel}>{row.label}</td>
                    <td className={`${styles.paceCell} ${row.pace1_best ? styles.bestSplit : ''}`}>
                      {formatPace(row.pace1_ms)}
                    </td>
                    <td>{formatRate(row.rate1)}</td>
                    <td>{formatNumber(row.hr1)}</td>
                    <td className={`${styles.paceCell} ${row.pace2_best ? styles.bestSplit : ''}`}>
                      {formatPace(row.pace2_ms)}
                    </td>
                    <td>{formatRate(row.rate2)}</td>
                    <td>{formatNumber(row.hr2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.legendBox} style={{ backgroundColor: 'var(--accent-2)' }} />
          <span>{formatDate(new Date(workout1.date))}</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendBox} style={{ backgroundColor: 'var(--accent)' }} />
          <span>{formatDate(new Date(workout2.date))}</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendBox} style={{ backgroundColor: 'var(--accent)' }} />
          <span>Faster</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendBox} style={{ backgroundColor: 'var(--hot)' }} />
          <span>Slower</span>
        </div>
      </div>
    </div>
  );
}

function ComparisonTooltip({ active, payload, label, formatPace }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-2) var(--space-3)',
      color: 'var(--ink)',
      fontSize: '0.78rem',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.18)',
    }}>
      <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
        {Math.round(label)}m
      </div>
      {payload.map(item => (
        <div key={item.dataKey} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', color: item.color }}>
          <span>{item.dataKey === 'pace_ms_1' ? 'Session 1' : 'Session 2'}</span>
          <strong>{formatPace(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function buildStrokeSeries(strokes = []) {
  const valid = strokes.filter(s => s?.pace_ms > 0 && s?.distance_m >= 0);
  if (valid.length <= 260) {
    return valid.map(formatStrokePoint);
  }

  const step = Math.max(1, Math.floor(valid.length / 260));
  const sampled = valid.filter((_, index) => index % step === 0);
  const last = valid[valid.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled.map(formatStrokePoint);
}

function formatStrokePoint(stroke) {
  return {
    distance: Math.round(stroke.distance_m),
    pace_ms: stroke.pace_ms,
    stroke_rate: stroke.stroke_rate,
    heart_rate: stroke.heart_rate,
  };
}

function buildComparisonSeries(data1, data2, distance1, distance2) {
  if (!data1.length || !data2.length) return [];

  const maxDistance = Math.max(distance1 || 0, distance2 || 0);
  const normalized1 = data1.map(d => ({ ...d, normalized_distance: (d.distance / (distance1 || maxDistance)) * maxDistance }));
  const normalized2 = data2.map(d => ({ ...d, normalized_distance: (d.distance / (distance2 || maxDistance)) * maxDistance }));

  const allDistances = [...new Set([
    ...normalized1.map(d => d.normalized_distance),
    ...normalized2.map(d => d.normalized_distance),
  ])].sort((a, b) => a - b);

  return allDistances.map(dist => {
    const p1 = normalized1.find(d => d.normalized_distance >= dist);
    const p2 = normalized2.find(d => d.normalized_distance >= dist);

    return {
      distance: Math.round(dist),
      pace_ms_1: p1?.pace_ms || null,
      pace_ms_2: p2?.pace_ms || null,
      diff_faster_than_1: p1 && p2 && p2.pace_ms < p1.pace_ms,
      diff_slower_than_1: p1 && p2 && p2.pace_ms > p1.pace_ms,
    };
  });
}

function buildSplitRows(workout1, workout2) {
  const rows1 = buildWorkoutSplits(workout1);
  const rows2 = buildWorkoutSplits(workout2);

  const maxLength = Math.max(rows1.length, rows2.length);
  const rows = [];

  for (let i = 0; i < maxLength; i++) {
    const r1 = rows1[i];
    const r2 = rows2[i];

    const pace1 = r1?.pace_ms;
    const pace2 = r2?.pace_ms;
    const bestPace = pace1 && pace2 ? Math.min(pace1, pace2) : (pace1 || pace2);

    rows.push({
      label: r1?.label || r2?.label || `${i + 1}`,
      pace1_ms: r1?.pace_ms,
      rate1: r1?.stroke_rate,
      hr1: r1?.heart_rate,
      pace1_best: pace1 && bestPace && pace1 === bestPace,
      pace2_ms: r2?.pace_ms,
      rate2: r2?.stroke_rate,
      hr2: r2?.heart_rate,
      pace2_best: pace2 && bestPace && pace2 === bestPace,
    });
  }

  return rows;
}

function buildWorkoutSplits(workout) {
  if (!workout) return [];

  if (workout.intervals?.length > 0) {
    return workout.intervals.map((interval, index) => ({
      label: `${index + 1}`,
      pace_ms: interval.pace_ms,
      stroke_rate: interval.stroke_rate,
      heart_rate: interval.heart_rate_avg,
    }));
  }

  const strokes = (workout.strokes || []).filter(s => s?.pace_ms > 0 && s?.distance_m >= 0);
  if (strokes.length < 2 || !workout.distance) return [];

  const splitSize = workout.distance <= 3000 ? 500 : 1000;
  const splitCount = Math.ceil(workout.distance / splitSize);
  const rows = [];

  for (let index = 0; index < splitCount; index++) {
    const start = index * splitSize;
    const end = Math.min((index + 1) * splitSize, workout.distance);
    const bucket = strokes.filter(stroke => stroke.distance_m >= start && stroke.distance_m <= end);
    if (bucket.length === 0) continue;

    rows.push({
      label: `${start}-${end}m`,
      pace_ms: average(bucket.map(s => s.pace_ms)),
      stroke_rate: average(bucket.map(s => s.stroke_rate)),
      heart_rate: average(bucket.map(s => s.heart_rate)),
    });
  }

  return rows;
}

function getComparisonStats(workout) {
  return {
    time_ms: workout.time_ms,
    pace_ms: workout.pace_ms,
    stroke_rate: workout.stroke_rate,
    heart_rate_avg: workout.heart_rate_avg,
    distance: workout.distance,
  };
}

function computeDeltas(stats1, stats2) {
  return {
    pace: stats2.pace_ms && stats1.pace_ms ? formatPaceDelta(stats1.pace_ms, stats2.pace_ms) : null,
    rate: stats2.stroke_rate && stats1.stroke_rate ? Math.round((stats2.stroke_rate - stats1.stroke_rate) * 10) / 10 : null,
    heartRate: stats2.heart_rate_avg && stats1.heart_rate_avg ? Math.round(stats2.heart_rate_avg - stats1.heart_rate_avg) : null,
  };
}

function formatPaceDelta(pace1Ms, pace2Ms) {
  const deltaSecs = (pace2Ms - pace1Ms) / 1000;
  return parseFloat((deltaSecs).toFixed(1));
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(Number(value)) && Number(value) > 0);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatTime(timeMs) {
  if (!timeMs || timeMs <= 0) return '--';
  const totalTenths = Math.round(timeMs / 100);
  const totalSeconds = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondText = `${String(seconds).padStart(2, '0')}.${tenths}`;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondText}`;
  }
  return `${minutes}:${secondText}`;
}

function formatNumber(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '--';
  return Math.round(Number(value)).toLocaleString();
}

function formatRate(value) {
  if (!value) return '--';
  const numeric = Number(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}
