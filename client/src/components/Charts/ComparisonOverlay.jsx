import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, ArrowLeftRight, ChevronsUpDown, Info } from 'lucide-react';
import { useUnits } from '../../context/UnitsContext.jsx';
import { AXIS_TICK } from '../../styles/chartTheme.js';
import {
  buildComparisonSplits, buildComparisonSummary, buildMetricSeries, buildRacePlayback,
  comparisonMetricCards, COMPARISON_METRICS,
} from '../../utils/workoutComparison.js';
import RaceReplay from './RaceReplay.jsx';
import styles from './ComparisonOverlay.module.css';

export default function ComparisonOverlay({ workout1, workout2, match = {}, onBack, onChange, onSwap }) {
  const { formatPace } = useUnits();
  const [metric, setMetric] = useState('pace');
  const splits = useMemo(() => buildComparisonSplits(workout1, workout2, match), [workout1, workout2, match]);
  const summary = useMemo(() => buildComparisonSummary(workout1, workout2, match, splits), [workout1, workout2, match, splits]);
  const series = useMemo(() => buildMetricSeries(workout1, workout2, metric, match.axis || 'percent'), [workout1, workout2, metric, match.axis]);
  const metricCards = useMemo(() => comparisonMetricCards(workout1, workout2), [workout1, workout2]);
  // Split the difference series into favourable/unfavourable halves so the
  // area chart can shade them; stroke rate has no better direction and keeps
  // the neutral single area.
  const betterDelta = COMPARISON_METRICS[metric].betterDelta;
  const deltaData = useMemo(() => {
    if (!betterDelta) return series.data;
    return series.data.map(point => point.delta == null
      ? { ...point, deltaGood: null, deltaBad: null }
      : point.delta < 0
        ? { ...point, deltaGood: point.delta, deltaBad: 0 }
        : { ...point, deltaGood: 0, deltaBad: point.delta });
  }, [series, betterDelta]);
  const showGap = splits.some(row => row.gap_s != null);
  const racePlayback = useMemo(() => buildRacePlayback(workout1, workout2), [workout1, workout2]);
  const date1 = formatDate(workout1.date);
  const date2 = formatDate(workout2.date);
  const formatMetric = value => metric === 'pace' ? formatPace(value) : value == null ? '—' : Math.round(value);
  const axisLabel = value => series.axis === 'percent' ? `${Math.round(value)}%`
    : series.axis === 'time' ? `${Math.round(value / 60)}m` : `${Math.round(value)}m`;

  return (
    <div className={styles.comparison}>
      <div className={styles.topbar}>
        <button onClick={onBack} className={styles.backButton}><ArrowLeft size={15} /> Session</button>
        <div className={styles.comparisonActions}>
          <button type="button" className={styles.secondaryButton} onClick={onChange}><ChevronsUpDown size={14} /> Change</button>
          <button type="button" className={styles.secondaryButton} onClick={onSwap}><ArrowLeftRight size={14} /> Swap</button>
        </div>
      </div>

      <header className={styles.header}>
        <h2 className={styles.headerTitle}>Workout Comparison</h2>
        <span className={`${styles.matchBadge} ${match.level === 'other' ? styles.matchOther : ''}`}>{match.reason || 'Comparison'}</span>
      </header>

      {match.level === 'other' && (
        <div className={styles.warning}><Info size={16} /> These workouts are not like-for-like. Charts use percentage completed and avoid declaring a total-result winner.</div>
      )}

      <section className={styles.summaryCard} aria-label="Comparison result">
        <div>
          <div className={styles.eyebrow}>This session</div>
          <div className={styles.summaryHeadline}>{summary.headline}</div>
          {summary.effort && <p className={styles.summaryText}>{summary.effort}</p>}
          {summary.pacing && <p className={styles.summaryText}>{summary.pacing}</p>}
        </div>
        {summary.where && (
          <div className={styles.whereGrid}>
            <SummaryFact label="First half" value={summary.where.firstHalf == null ? null : `${summary.where.firstHalf}s/500`} />
            <SummaryFact label="Second half" value={summary.where.secondHalf == null ? null : `${summary.where.secondHalf}s/500`} />
            <SummaryFact label="Strongest" value={withDelta(summary.where.strongest, summary.where.strongestDelta)} />
            <SummaryFact label="Weakest" value={withDelta(summary.where.weakest, summary.where.weakestDelta)} />
          </div>
        )}
      </section>

      <div className={styles.dualHeader}>
        <SessionColumn workout={workout1} date={date1} chip="This session" formatPace={formatPace} />
        <SessionColumn workout={workout2} date={date2} formatPace={formatPace} />
      </div>

      {metricCards.length > 0 && (
        <div className={styles.metricCardGrid}>
          {metricCards.map(card => (
            <div className={styles.metricDeltaCard} key={card.label}>
              <span>{card.label}</span>
              <strong>{formatCompact(card.value1)}{card.unit}</strong>
              <small>vs {formatCompact(card.value2)}{card.unit} · <span className={tileDeltaClass(card, styles)}>Δ {signed(card.delta)}{card.unit}</span></small>
            </div>
          ))}
        </div>
      )}

      {racePlayback && (
        <RaceReplay
          playback={racePlayback}
          laneOne={{ label: date1, chip: 'This session' }}
          laneTwo={{ label: date2 }}
          formatPace={formatPace}
        />
      )}

      <section className={styles.card}>
        <div className={styles.chartHeader}>
          <div className={styles.cardTitle}>Performance overlay</div>
          <div className={styles.metricTabs} role="group" aria-label="Chart metric">
            {Object.entries(COMPARISON_METRICS).map(([key, config]) => (
              <button key={key} type="button" className={metric === key ? styles.metricTabActive : ''} onClick={() => setMetric(key)}>{config.label}</button>
            ))}
          </div>
        </div>
        {series.data.some(point => point.value1 != null || point.value2 != null) ? (
          <>
            <div className={styles.chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.data} margin={{ top: 10, right: 12, bottom: 0, left: 2 }}>
                  <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
                  <XAxis dataKey="x" tick={AXIS_TICK} tickFormatter={axisLabel} axisLine={false} tickLine={false} />
                  <YAxis reversed={metric === 'pace'} tick={AXIS_TICK} tickFormatter={formatMetric} axisLine={false} tickLine={false} width={58} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip metric={metric} formatPace={formatPace} date1={date1} date2={date2} axis={series.axis} />} />
                  <Line type="monotone" dataKey="value1" name={date1} stroke="var(--accent-2)" strokeWidth={2.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="value2" name={date2} stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className={styles.deltaChart}>
              <div className={styles.deltaLabel}>{deltaChartLabel(metric)}</div>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={deltaData} margin={{ top: 4, right: 12, bottom: 0, left: 60 }}>
                  <XAxis dataKey="x" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="var(--ink-3)" strokeDasharray="3 4" />
                  <Tooltip content={<DeltaTooltip metric={metric} axis={series.axis} />} />
                  {betterDelta ? [
                    <Area key="good" type="monotone" dataKey="deltaGood" stroke="none" fill="var(--positive)" fillOpacity={0.3} connectNulls={false} />,
                    <Area key="bad" type="monotone" dataKey="deltaBad" stroke="none" fill="var(--negative)" fillOpacity={0.3} connectNulls={false} />,
                  ] : (
                    <Area type="monotone" dataKey="delta" stroke="var(--accent-2)" fill="var(--accent-2)" fillOpacity={0.18} connectNulls={false} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : <div className={styles.emptyState}>No {COMPARISON_METRICS[metric].label.toLowerCase()} trace is available for both workouts.</div>}
      </section>

      {splits.length > 0 && (
        <section className={styles.card}>
          <div className={styles.cardHeader}><div className={styles.cardTitle}>Splits comparison</div></div>
          <div className={styles.tableWrap}>
            <table className={styles.splitsTable}>
              <thead><tr><th>Split</th><th>{date1} pace</th><th>{date2} pace</th><th>Δ pace</th>{showGap && <th>Gap</th>}<th>Rate Δ</th><th>HR Δ</th></tr></thead>
              <tbody>{splits.map(row => (
                <tr key={row.label}>
                  <td className={styles.splitLabel}>{row.label}</td>
                  <td>{formatPace(row.pace1_ms)}</td><td>{formatPace(row.pace2_ms)}</td>
                  <td className={paceDeltaClass(row.pace_delta_ms, styles)}>{row.pace_delta_ms == null ? '—' : `${signed(row.pace_delta_ms / 1000)}s`}</td>
                  {showGap && <td className={gapClass(row.gap_s, styles)}>{row.gap_s == null ? '—' : `${signed(row.gap_s)}s`}</td>}
                  <td>{delta(row.rate1, row.rate2)}</td><td>{delta(row.hr1, row.hr2)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryFact({ label, value }) { return <div><span>{label}</span><strong>{value || '—'}</strong></div>; }

function SessionColumn({ workout, date, chip, formatPace }) {
  return <div className={styles.sessionColumn}>
    <div className={styles.columnTitle}>{date}{chip && <span className={styles.columnChip}>{chip}</span>}</div>
    <div className={styles.columnMeta}>{formatTime(workout.time_ms)} · {Number(workout.distance || 0).toLocaleString()}m</div>
    <div className={styles.statsGrid}>
      <Stat label="Pace" value={formatPace(workout.pace_ms)} />
      <Stat label="Rate" value={workout.stroke_rate ? `${formatCompact(workout.stroke_rate)} spm` : '—'} />
      <Stat label="HR" value={workout.heart_rate_avg ? `${Math.round(workout.heart_rate_avg)} bpm` : '—'} />
    </div>
  </div>;
}
function Stat({ label, value }) { return <div className={styles.statCell}><div className={styles.statLabel}>{label}</div><div className={styles.statValue}>{value}</div></div>; }

function DeltaTooltip({ active, payload, label, metric, axis }) {
  if (!active || !payload?.length) return null;
  const deltaValue = payload[0]?.payload?.delta;
  if (deltaValue == null) return null;
  const formatted = metric === 'pace' ? `${signed(deltaValue / 1000)}s/500`
    : metric === 'rate' ? `${signed(deltaValue)} spm` : `${signed(Math.round(deltaValue))} bpm`;
  const x = axis === 'percent' ? `${Math.round(label)}%` : axis === 'time' ? `${Math.round(label)}s` : `${Math.round(label)}m`;
  return <div className={styles.tooltip}><small>{x}</small><div><span>This session</span><strong>{formatted}</strong></div></div>;
}

function ChartTooltip({ active, payload, label, metric, formatPace, date1, date2, axis }) {
  if (!active || !payload?.length) return null;
  const format = value => metric === 'pace' ? formatPace(value) : Math.round(value);
  const x = axis === 'percent' ? `${Math.round(label)}%` : axis === 'time' ? `${Math.round(label)}s` : `${Math.round(label)}m`;
  return <div className={styles.tooltip}><small>{x}</small><div><span>{date1}</span><strong>{format(payload.find(item => item.dataKey === 'value1')?.value)}</strong></div><div><span>{date2}</span><strong>{format(payload.find(item => item.dataKey === 'value2')?.value)}</strong></div></div>;
}

function formatDate(date) { return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }); }
function formatTime(ms) { if (!ms) return '—'; const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function formatCompact(value) { return Number(value).toFixed(Number(value) % 1 ? 1 : 0); }
function signed(value) { if (!Number.isFinite(Number(value))) return '—'; const n = Number(value); return `${n > 0 ? '+' : ''}${formatCompact(n)}`; }
function delta(a, b) { return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && a > 0 && b > 0 ? signed(a - b) : '—'; }
function paceDeltaClass(value, style) { if (!Number.isFinite(value) || Math.abs(value) < 50) return ''; return value < 0 ? style.deltaNegative : style.deltaPositive; }
function gapClass(value, style) { if (!Number.isFinite(value) || Math.abs(value) < 0.5) return ''; return value < 0 ? style.deltaNegative : style.deltaPositive; }
function withDelta(label, deltaText) { return label ? (deltaText ? `${label} · ${deltaText}s` : label) : null; }
function tileDeltaClass(card, style) {
  if (!card.better || !Number.isFinite(card.delta) || card.delta === 0) return '';
  const improved = card.better === 'up' ? card.delta > 0 : card.delta < 0;
  return improved ? style.deltaNegative : style.deltaPositive;
}
function deltaChartLabel(metric) {
  if (metric === 'pace') return 'Pace gap · green where this session was faster';
  if (metric === 'hr') return 'Heart rate gap · green where this session was lower';
  return 'Stroke rate difference · this session minus comparison';
}
