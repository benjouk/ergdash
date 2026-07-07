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
import { AXIS_TICK } from '../../styles/chartTheme.js';
import { useIsMobile, niceTicksFromZero } from './useChartData.js';
import styles from './ComparisonOverlay.module.css';

export default function ComparisonOverlay({ workout1, workout2, onBack }) {
  const { formatPace } = useUnits();
  const isMobile = useIsMobile();

  const strokeData1 = useMemo(() => buildStrokeSeries(workout1?.strokes), [workout1?.strokes]);
  const strokeData2 = useMemo(() => buildStrokeSeries(workout2?.strokes), [workout2?.strokes]);
  const comparisonData = useMemo(
    () => buildComparisonSeries(strokeData1, strokeData2, workout1?.distance, workout2?.distance),
    [strokeData1, strokeData2, workout1?.distance, workout2?.distance]
  );

  const stats1 = getComparisonStats(workout1);
  const stats2 = getComparisonStats(workout2);
  // Deltas describe the session being viewed (workout1) relative to the
  // comparison, so a negative pace delta means "this session was faster".
  const deltas = computeDeltas(stats1, stats2);

  const dateLabel1 = formatDate(new Date(workout1.date));
  const dateLabel2 = formatDate(new Date(workout2.date));

  // Calculate dynamic Y-axis padding based on pace range to scale for fast/slow rowers
  const yAxisPadding = useMemo(() => {
    const maxPace = Math.max(workout1?.pace_ms || 0, workout2?.pace_ms || 0);
    return Math.max(1500, Math.round(maxPace * 0.03));
  }, [workout1?.pace_ms, workout2?.pace_ms]);

  const distanceTicks = useMemo(
    () => niceTicksFromZero(Math.max(workout1?.distance || 0, workout2?.distance || 0), isMobile ? 4 : 6),
    [workout1?.distance, workout2?.distance, isMobile]
  );
  const distanceDomain = useMemo(() => [0, distanceTicks[distanceTicks.length - 1]], [distanceTicks]);

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
          <div className={styles.columnTitle}>
            {dateLabel1}
            <span className={styles.columnChip}>This session</span>
          </div>
          <div className={styles.columnMeta}>{formatTime(workout1.time_ms)} · {formatNumber(workout1.distance)}m</div>
          <div className={styles.statsGrid}>
            {[
              { label: 'Pace', value: formatPace(workout1.pace_ms), delta: deltas.pace, deltaClass: deltaClassFor(deltas.pace, styles) },
              { label: 'Rate', value: formatRate(workout1.stroke_rate), unit: 'spm', delta: deltas.rate, deltaClass: '' },
              { label: 'HR', value: formatNumber(workout1.heart_rate_avg), unit: 'bpm', delta: deltas.heartRate, deltaClass: deltaClassFor(deltas.heartRate, styles) },
            ].map(stat => (
              <div key={stat.label} className={styles.statCell}>
                <div className={styles.statLabel}>{stat.label}</div>
                <div className={styles.statValue}>{stat.value}{stat.unit && <span className={styles.statUnit}>{stat.unit}</span>}</div>
                {stat.delta != null && (
                  <div
                    className={`${styles.statDelta} ${stat.deltaClass}`}
                    title={`vs ${dateLabel2}`}
                  >
                    {stat.delta > 0 ? '+' : ''}{stat.delta}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.sessionColumn}>
          <div className={styles.columnTitle}>{dateLabel2}</div>
          <div className={styles.columnMeta}>{formatTime(workout2.time_ms)} · {formatNumber(workout2.distance)}m</div>
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
                <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
                <XAxis
                  dataKey="distance"
                  type="number"
                  domain={distanceDomain}
                  ticks={distanceTicks}
                  tick={AXIS_TICK}
                  tickFormatter={v => `${v}m`}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  reversed
                  allowDecimals={false}
                  tick={AXIS_TICK}
                  tickFormatter={v => formatPace(v)}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                  domain={[`dataMin - ${yAxisPadding}`, `dataMax + ${yAxisPadding}`]}
                />
                <Tooltip content={<ComparisonTooltip formatPace={formatPace} label1={dateLabel1} label2={dateLabel2} />} />

                {/* Difference bands between the lines: green where this
                    session was faster than the comparison, red where slower */}
                <Area
                  type="monotone"
                  dataKey="band_faster"
                  fill="var(--positive)"
                  fillOpacity={0.14}
                  stroke="none"
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="band_slower"
                  fill="var(--negative)"
                  fillOpacity={0.14}
                  stroke="none"
                  activeDot={false}
                  isAnimationActive={false}
                />

                <Line
                  type="monotone"
                  dataKey="pace_ms_1"
                  stroke="var(--accent-2)"
                  strokeWidth={2}
                  dot={false}
                  name={dateLabel1}
                />
                <Line
                  type="monotone"
                  dataKey="pace_ms_2"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                  name={dateLabel2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <div className={styles.legendBox} style={{ backgroundColor: 'var(--accent-2)' }} />
              <span>{dateLabel1} (this session)</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendBox} style={{ backgroundColor: 'var(--accent)' }} />
              <span>{dateLabel2}</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendBox} style={{ backgroundColor: 'var(--positive)' }} />
              <span>This session faster</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendBox} style={{ backgroundColor: 'var(--negative)' }} />
              <span>This session slower</span>
            </div>
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
                  <th colSpan="3" className={styles.sessionHeader1}>{dateLabel1}</th>
                  <th colSpan="3" className={styles.sessionHeader2}>{dateLabel2}</th>
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

    </div>
  );
}

function ComparisonTooltip({ active, payload, label, formatPace, label1, label2 }) {
  if (!active || !payload?.length) return null;

  const uniquePayload = Array.from(
    new Map(payload.map(item => [item.dataKey, item])).values()
  ).filter(item => item.dataKey === 'pace_ms_1' || item.dataKey === 'pace_ms_2');
  if (uniquePayload.length === 0) return null;

  const pace1 = uniquePayload.find(item => item.dataKey === 'pace_ms_1')?.value;
  const pace2 = uniquePayload.find(item => item.dataKey === 'pace_ms_2')?.value;
  const deltaSecs = pace1 != null && pace2 != null ? (pace1 - pace2) / 1000 : null;

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
      {uniquePayload.map(item => (
        <div key={item.dataKey} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', color: item.color }}>
          <span>{item.dataKey === 'pace_ms_1' ? label1 : label2}</span>
          <strong>{formatPace(item.value)}</strong>
        </div>
      ))}
      {deltaSecs != null && Math.abs(deltaSecs) >= 0.05 && (
        <div style={{
          display: 'flex',
          gap: 10,
          justifyContent: 'space-between',
          marginTop: 4,
          paddingTop: 4,
          borderTop: '1px solid var(--rule)',
          color: deltaSecs < 0 ? 'var(--positive)' : 'var(--negative)',
          fontFamily: 'var(--font-mono)',
        }}>
          <span>Δ</span>
          <strong>{deltaSecs > 0 ? '+' : ''}{deltaSecs.toFixed(1)}s</strong>
        </div>
      )}
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

// Resample both sessions onto a shared distance grid, averaging the strokes
// that fall in each bucket. Per-stroke pace is far too noisy to overlay
// directly — two raw traces cross constantly and the difference bands
// shatter into slivers. Bucket averaging keeps the pacing story readable
// while empty buckets (rest periods) still render as gaps.
function buildComparisonSeries(data1, data2, distance1, distance2) {
  if (!data1.length || !data2.length) return [];

  const maxDistance = Math.max(distance1 || 0, distance2 || 0);
  if (!maxDistance) return [];

  // Normalise slightly different actual distances (±100m tolerance upstream)
  // onto the same 0..maxDistance scale before bucketing.
  const scale1 = maxDistance / (distance1 || maxDistance);
  const scale2 = maxDistance / (distance2 || maxDistance);

  const bucketSize = Math.max(10, maxDistance / 120);
  const bucketCount = Math.ceil(maxDistance / bucketSize);
  const buckets = Array.from({ length: bucketCount }, () => ({ sum1: 0, n1: 0, sum2: 0, n2: 0 }));

  const bucketIndex = (distance, scale) =>
    Math.min(bucketCount - 1, Math.floor((distance * scale) / bucketSize));
  for (const d of data1) {
    const b = buckets[bucketIndex(d.distance, scale1)];
    b.sum1 += d.pace_ms;
    b.n1 += 1;
  }
  for (const d of data2) {
    const b = buckets[bucketIndex(d.distance, scale2)];
    b.sum2 += d.pace_ms;
    b.n2 += 1;
  }

  return buckets.map((b, i) => {
    const pace1 = b.n1 ? b.sum1 / b.n1 : null;
    const pace2 = b.n2 ? b.sum2 / b.n2 : null;

    return {
      distance: Math.round((i + 0.5) * bucketSize),
      pace_ms_1: pace1,
      pace_ms_2: pace2,
      // Range-area bands between the two lines, split by which session leads.
      // Lower pace_ms = faster, so workout1 is ahead where pace1 < pace2.
      band_faster: pace1 && pace2 && pace1 < pace2 ? [pace1, pace2] : null,
      band_slower: pace1 && pace2 && pace1 > pace2 ? [pace2, pace1] : null,
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

// All deltas are stats1 - stats2: how the session being viewed compares
// with the comparison session.
function computeDeltas(stats1, stats2) {
  return {
    pace: stats2.pace_ms && stats1.pace_ms ? parseFloat(((stats1.pace_ms - stats2.pace_ms) / 1000).toFixed(1)) : null,
    rate: stats2.stroke_rate && stats1.stroke_rate ? Math.round((stats1.stroke_rate - stats2.stroke_rate) * 10) / 10 : null,
    heartRate: stats2.heart_rate_avg && stats1.heart_rate_avg ? Math.round(stats1.heart_rate_avg - stats2.heart_rate_avg) : null,
  };
}

// Pace and HR are "lower is better"; positive deltas read as red. Stroke
// rate has no better/worse direction, so its delta stays neutral (no class).
function deltaClassFor(delta, styles) {
  if (delta == null || delta === 0) return '';
  return delta > 0 ? styles.deltaPositive : styles.deltaNegative;
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(Number(value)) && Number(value) > 0);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
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
