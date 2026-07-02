import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Flame,
  Gauge,
  HeartPulse,
  Loader2,
  Lock,
  MessageSquare,
  Share2,
  Timer,
  Zap,
  GitCompare,
  ChevronDown,
} from 'lucide-react';
import { api } from '../api.js';
import { AXIS_TICK } from '../styles/chartTheme.js';
import { useUnits } from '../context/UnitsContext.jsx';
import PaceRibbon from '../components/PaceRibbon/PaceRibbon.jsx';
import Sparkline from '../components/Feed/Sparkline.jsx';
import ComparisonOverlay from '../components/Charts/ComparisonOverlay.jsx';
import IntervalRepChart from '../components/Session/IntervalRepChart.jsx';
import RateVsPaceScatter from '../components/Charts/RateVsPaceScatter.jsx';
import ZoneBar from '../components/Stats/ZoneBar.jsx';
import styles from './Session.module.css';

export default function Session() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareId, setCompareId] = useState(null);
  const [comparisonWorkout, setComparisonWorkout] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [compareOptions, setCompareOptions] = useState([]);
  const { units, formatPace, formatDistance, formatDistanceFull, formatTime } = useUnits();
  const [compareMenuOpen, setCompareMenuOpen] = useState(false);
  const compareMenuRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    setCompareMode(false);
    setCompareId(null);
    api.getWorkout(id)
      .then(currentWorkout => {
        setWorkout(currentWorkout);
        if (!currentWorkout.strokes?.length && !currentWorkout.pace_profile?.length) {
          setEnriching(true);
          api.enrichWorkout(id)
            .then(() => api.getWorkout(id))
            .then(setWorkout)
            .catch(() => {})
            .finally(() => setEnriching(false));
        }

        // Load comparison options: other workouts of the same distance (±100m tolerance)
        // This range accommodates slight variations in actual distance rowed vs. workout distance target
        return Promise.all([
          Promise.resolve(currentWorkout),
          api.getWorkouts({ min_distance: currentWorkout.distance - 100, limit: 50 }),
        ]);
      })
      .then(([currentWorkout, workoutsData]) => {
        // Filter to workouts within ±100m and exclude current workout, limit to 20 most recent
        const options = (workoutsData.data || [])
          .filter(w => w.id !== currentWorkout.id && Math.abs(w.distance - currentWorkout.distance) < 100)
          .slice(0, 20);
        setCompareOptions(options);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleShare = useCallback(async () => {
    if (!workout) return;

    const title = `${formatTime(workout.time_ms)} Row`;
    const text = `${title} - ${formatDistanceFull(workout.distance)} at ${formatPace(workout.pace_ms)}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: 'RowDash workout', text, url: window.location.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      setCopied(false);
    }
  }, [formatDistanceFull, formatPace, formatTime, workout]);

  const handleCompare = useCallback((comparisonWorkoutId) => {
    setCompareMenuOpen(false);
    setComparisonLoading(true);
    setCompareId(comparisonWorkoutId);
    api.getCompare(id, comparisonWorkoutId)
      .then(data => {
        setComparisonWorkout(data.workouts[1]);
        setCompareMode(true);
      })
      .catch(() => {
        setCompareId(null);
      })
      .finally(() => setComparisonLoading(false));
  }, [id]);

  useEffect(() => {
    if (!compareMenuOpen) return;

    const handlePointerDown = (event) => {
      if (compareMenuRef.current && !compareMenuRef.current.contains(event.target)) {
        setCompareMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setCompareMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [compareMenuOpen]);

  const handleExitComparison = useCallback(() => {
    setCompareMode(false);
    setCompareId(null);
    setComparisonWorkout(null);
  }, []);

  const strokeData = useMemo(() => buildStrokeSeries(workout?.strokes), [workout?.strokes]);
  const splitRows = useMemo(() => buildSplitRows(workout), [workout]);

  if (loading) return <div style={{ padding: 'var(--space-6)', color: 'var(--ink-3)' }}>Loading...</div>;
  if (!workout) return <div style={{ padding: 'var(--space-6)', color: 'var(--ink-3)' }}>Workout not found</div>;

  if (compareMode && comparisonWorkout) {
    return <ComparisonOverlay workout1={workout} workout2={comparisonWorkout} onBack={handleExitComparison} />;
  }

  const date = new Date(workout.date);
  const tag = workout.inferred_tag;
  const isInterval = tag === 'interval';
  const avgWatts = paceToWatts(workout.pace_ms);
  const avgCalHr = wattsToCalHr(avgWatts);
  const hasStrokeRate = strokeData.some(d => d.stroke_rate > 0);
  const hasHeartRate = strokeData.some(d => d.heart_rate > 0);
  const hasAnalysis = strokeData.length > 1;
  const hasPaceProfile = !hasAnalysis && workout.pace_profile?.length >= 2;
  const comments = workout.comments?.trim();
  const primaryMetric = getPrimaryMetric(units);

  const summaryItems = [
    { label: 'Time', value: formatTimePrecise(workout.time_ms) },
    { label: 'Distance', value: formatDistanceNumber(workout.distance), unit: 'm' },
    { label: primaryMetric.averageLabel, value: formatPace(workout.pace_ms), unit: primaryMetric.unit, accent: true },
    { label: 'Power', value: formatNumber(avgWatts), unit: 'w' },
    { label: 'Rate', value: formatRate(workout.stroke_rate), unit: 'spm' },
    { label: 'Cal/hr', value: formatNumber(avgCalHr) },
  ];

  const detailRows = [
    { label: 'Stroke Count', value: formatNumber(workout.stroke_count), icon: BarChart3 },
    { label: 'Total Calories', value: formatNumber(workout.calories), unit: 'cal', icon: Flame },
    { label: 'Drag Factor', value: formatNumber(workout.drag_factor), icon: Gauge },
    { label: 'Ave. Heart Rate', value: formatNumber(workout.heart_rate_avg), unit: 'bpm', icon: HeartPulse },
    { label: 'Max Heart Rate', value: formatNumber(workout.heart_rate_max), unit: 'bpm', icon: HeartPulse },
    workout.metrics?.drag_delta != null ? { label: 'Drag Delta', value: signed(workout.metrics.drag_delta), icon: Gauge } : null,
    workout.metrics?.distance_per_stroke != null ? { label: 'Distance Per Stroke', value: `${workout.metrics.distance_per_stroke.toFixed(2)}`, unit: 'm', icon: Activity } : null,
    workout.metrics?.watts_per_beat != null ? { label: 'Watts Per Beat', value: workout.metrics.watts_per_beat.toFixed(2), icon: Zap } : null,
    workout.metrics?.hr_drift_pct != null ? { label: 'HR Drift', value: `${workout.metrics.hr_drift_pct > 0 ? '+' : ''}${workout.metrics.hr_drift_pct.toFixed(1)}%${Math.abs(workout.metrics.hr_drift_pct) < 5 ? ' · coupled' : ''}`, icon: HeartPulse } : null,
    workout.metrics?.rate_discipline != null ? { label: 'Rate Discipline', value: workout.metrics.rate_discipline.toFixed(0), icon: Activity } : null,
    workout.metrics?.hr_recovery_avg != null ? { label: 'Avg HR Recovery', value: signed(workout.metrics.hr_recovery_avg), unit: 'bpm', icon: HeartPulse } : null,
    workout.metrics?.fade_index != null ? { label: 'Fade Index', value: `${workout.metrics.fade_index.toFixed(1)}%`, icon: Activity } : null,
    workout.metrics?.consistency != null ? { label: 'Consistency', value: workout.metrics.consistency.toFixed(0), icon: Activity } : null,
    workout.metrics?.effort_score != null ? { label: 'Effort Score', value: workout.metrics.effort_score.toFixed(0), icon: Gauge } : null,
    workout.rest_distance ? { label: 'Rest Distance', value: formatDistanceNumber(workout.rest_distance), unit: 'm', icon: Timer } : null,
    workout.rest_time_ms ? { label: 'Rest Time', value: formatTimePrecise(workout.rest_time_ms), icon: Timer } : null,
  ].filter(Boolean);

  return (
    <div className={styles.session}>
      <div className={styles.topbar}>
        <button onClick={() => navigate(-1)} className={styles.backButton}>
          <ArrowLeft size={15} /> Back
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-3)' }}>
          {compareOptions.length > 0 && (
            <div className={styles.compareWrapper} ref={compareMenuRef}>
              <button
                type="button"
                onClick={() => setCompareMenuOpen(open => !open)}
                disabled={comparisonLoading}
                className={styles.compareButton}
                aria-haspopup="listbox"
                aria-expanded={compareMenuOpen}
              >
                {comparisonLoading
                  ? <Loader2 size={15} className={styles.spinner} />
                  : <GitCompare size={15} />}
                <span>Compare</span>
                <ChevronDown size={13} className={styles.compareChevron} />
              </button>
              {compareMenuOpen && (
                <ul className={styles.compareMenu} role="listbox">
                  {compareOptions.map(w => {
                    const isInterval = w.inferred_tag === 'interval';
                    return (
                      <li key={w.id} role="option" aria-selected={compareId === w.id}>
                        <button
                          type="button"
                          className={styles.compareOption}
                          onClick={() => handleCompare(w.id)}
                        >
                          <span className={styles.compareOptionRow}>
                            <span className={styles.compareOptionDate}>
                              <CalendarDays size={12} />
                              {formatDateShort(new Date(w.date))}
                            </span>
                            {w.inferred_tag && (
                              <span className={`${styles.tag} ${isInterval ? styles.tagInterval : ''}`}>
                                {w.inferred_tag}
                              </span>
                            )}
                          </span>
                          <span className={styles.compareOptionStats}>
                            <span>{formatDistance(w.distance)}</span>
                            <span className={styles.compareOptionDot}>·</span>
                            <span>{formatPace(w.pace_ms)}</span>
                            <span className={styles.compareOptionDot}>·</span>
                            <span>{formatTime(w.time_ms)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          <button onClick={handleShare} className={styles.iconButton} title={copied ? 'Link copied' : 'Share workout'} aria-label="Share workout">
            <Share2 size={15} />
          </button>
        </div>
      </div>

      <header className={styles.hero}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.sessionTitle}>{formatTime(workout.time_ms)} Row</h1>
            <div className={styles.metaLine}>
              <CalendarDays size={14} />
              <span>{formatDateShort(date)}</span>
              <span>·</span>
              <span>{formatClock(date)}</span>
            </div>
            <div className={styles.privacyLine}>
              <Lock size={13} />
              <span>Training Partners</span>
            </div>
          </div>

          {tag && (
            <span className={`${styles.tag} ${isInterval ? styles.tagInterval : ''}`}>
              {tag}
            </span>
          )}
        </div>
      </header>

      <div className={styles.summaryStrip}>
        {summaryItems.map(item => (
          <div className={styles.summaryCell} key={item.label}>
            <span className={styles.summaryCellLabel}>{item.label}</span>
            <span className={`${styles.summaryCellValue} ${item.accent ? styles.accentValue : ''}`}>
              {item.value}
              {item.unit && <span className={styles.summaryCellUnit}>{item.unit}</span>}
            </span>
          </div>
        ))}
      </div>

      {workout.strokes?.length > 0 && (
        <div className={`${styles.card} ${styles.cardVisible}`}>
          <div className={styles.chartStack}>
            <div className={styles.chartBlock}>
              <div className={styles.chartLabel}>Pace Ribbon</div>
              <PaceRibbon strokes={workout.strokes} height={48} />
            </div>
          </div>
        </div>
      )}

      {workout.zone_times?.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>HR Zones</div>
          </div>
          <ZoneBar zoneTimes={workout.zone_times} />
        </div>
      )}

      {workout.ai_note && (
        <div className={styles.aiNote}>
          {workout.ai_note}
        </div>
      )}

      {hasPaceProfile && (
        <div className={styles.card}>
          <div className={styles.chartStack}>
            <div className={styles.chartBlock}>
              <div className={styles.chartLabel}>
                Pace profile
              </div>
              <div className={styles.sparklineBox}>
                <Sparkline
                  data={workout.pace_profile}
                  color={isInterval ? 'var(--accent-2)' : 'var(--accent)'}
                  width={600}
                  height={80}
                  strokeWidth={2}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasAnalysis && !hasPaceProfile && (
        <div className={styles.card}>
          <div className={styles.emptyState}>
            {enriching ? (
              <>
                <Loader2 size={28} className={`${styles.emptyIcon} ${styles.spinner}`} />
                <p className={styles.emptyText}>Fetching stroke data from Concept2…</p>
              </>
            ) : (
              <>
                <BarChart3 size={28} className={styles.emptyIcon} />
                <p className={styles.emptyText}>No stroke-level data available for this workout.</p>
              </>
            )}
          </div>
        </div>
      )}

      {hasAnalysis && (
        <div className={styles.primaryGrid}>
          <div className={styles.card}>
            <div className={styles.chartStack}>
              <div className={styles.chartBlock}>
                <div className={styles.chartLabel}>
                  {primaryMetric.chartLabel} <span className={styles.chartUnit}>{primaryMetric.chartUnit}</span>
                </div>
                <div className={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={strokeData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
                      <XAxis dataKey="distance" tick={AXIS_TICK} tickFormatter={v => `${v}m`} axisLine={false} tickLine={false} />
                      <YAxis reversed tick={AXIS_TICK} tickFormatter={v => formatPace(v)} axisLine={false} tickLine={false} width={58} domain={['dataMin - 1500', 'dataMax + 1500']} />
                      <ReferenceLine y={workout.pace_ms} stroke="var(--ink-2)" strokeDasharray="4 4" />
                      <Tooltip content={<ChartTooltip formatPace={formatPace} />} />
                      <Area type="monotone" dataKey="pace_ms" stroke="var(--accent)" strokeWidth={2} fill="url(#paceFill)" dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {(hasStrokeRate || hasHeartRate) && (
            <div className={styles.card}>
              <div className={styles.chartStack}>
                <div className={styles.chartBlock}>
                  <div className={styles.chartLabel}>
                    Stroke Rate <span className={styles.chartUnit}>spm</span>
                    {hasHeartRate && <> · Heart Rate <span className={styles.chartUnit}>bpm</span></>}
                  </div>
                  <div className={`${styles.chartBox}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={strokeData} margin={{ top: 8, right: hasHeartRate ? 8 : 0, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
                        <XAxis dataKey="distance" tick={AXIS_TICK} tickFormatter={v => `${v}m`} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="rate" tick={AXIS_TICK} axisLine={false} tickLine={false} width={38} domain={['dataMin - 2', 'dataMax + 2']} />
                        {hasHeartRate && <YAxis yAxisId="hr" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={38} domain={['dataMin - 5', 'dataMax + 5']} />}
                        {workout.stroke_rate && <ReferenceLine yAxisId="rate" y={workout.stroke_rate} stroke="var(--ink-2)" strokeDasharray="4 4" />}
                        <Tooltip content={<ChartTooltip formatPace={formatPace} />} />
                        {hasStrokeRate && <Line yAxisId="rate" type="stepAfter" dataKey="stroke_rate" stroke="var(--accent-2)" strokeWidth={2} dot={false} />}
                        {hasHeartRate && <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="var(--hr)" strokeWidth={1.8} dot={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {workout.intervals?.filter(i => i.type !== 'rest').length >= 2 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Interval Reps</div>
            <span className={styles.cardKicker}>
              {workout.intervals.filter(i => i.type !== 'rest').length} reps
            </span>
          </div>
          <IntervalRepChart intervals={workout.intervals} formatPace={formatPace} />
        </div>
      )}

      {hasAnalysis && workout.strokes?.filter(s => s.stroke_rate > 0 && s.pace_ms > 0).length >= 20 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Rate vs Pace</div>
            {hasHeartRate && <span className={styles.cardKicker}>coloured by HR</span>}
          </div>
          <RateVsPaceScatter strokes={workout.strokes} formatPace={formatPace} />
        </div>
      )}

      {splitRows.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Splits</div>
            <span className={styles.cardKicker}>{splitRows.length} splits</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.splitsTable}>
              <thead>
                <tr>
                  <th>Split</th>
                  <th>Time</th>
                  <th>Pace</th>
                  <th>Rate</th>
                  <th>HR</th>
                  {splitRows.some(r => r.calories > 0) && <th>Cal</th>}
                  {splitRows.some(r => r.recovery_bpm != null) && <th>Recovery</th>}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const bestPace = Math.min(...splitRows.map(r => r.pace_ms).filter(Boolean));
                  const hasCalories = splitRows.some(r => r.calories > 0);
                  const hasRecovery = splitRows.some(r => r.recovery_bpm != null);
                  return splitRows.map(row => {
                  const barWidth = row.pace_ms && bestPace && Number.isFinite(bestPace) ? (bestPace / row.pace_ms) * 100 : 0;
                  return (
                    <tr key={row.key} className={row.best ? styles.bestRow : undefined}>
                      <td>{row.label}</td>
                      <td>{formatTimePrecise(row.time_ms)}</td>
                      <td className={`${styles.paceCell} ${row.best ? styles.bestSplit : ''}`}>
                        {barWidth > 0 && <div className={styles.paceBar} style={{ width: `${barWidth}%` }} />}
                        {formatPace(row.pace_ms)}
                      </td>
                      <td>{row.stroke_rate ? row.stroke_rate.toFixed(1) : '--'}</td>
                      <td>{row.heart_rate ? Math.round(row.heart_rate) : '--'}</td>
                      {hasCalories && <td>{row.calories ? Math.round(row.calories) : '--'}</td>}
                      {hasRecovery && (
                        <td style={row.recovery_bpm != null ? { color: row.recovery_bpm > 0 ? 'var(--positive)' : 'var(--negative)' } : undefined}>
                          {row.recovery_bpm != null ? `${row.recovery_bpm > 0 ? '−' : '+'}${Math.abs(row.recovery_bpm)}` : '--'}
                        </td>
                      )}
                    </tr>
                  );
                });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>Details</div>
        </div>
        <div className={styles.detailRows}>
          {detailRows.map(row => {
            const Icon = row.icon;
            return (
              <div className={styles.detailRow} key={row.label}>
                <div className={styles.detailLabel}>
                  {Icon && <Icon className={styles.detailIcon} size={14} />}
                  {row.label}
                </div>
                <div className={styles.detailValue}>
                  {row.value}
                  {row.unit && <span className={styles.detailUnit}>{row.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {comments && (
          <div className={styles.note}>
            <div className={styles.noteLabel}>
              <MessageSquare size={13} />
              Notes
            </div>
            <p>{comments}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, formatPace }) {
  if (!active || !payload?.length) return null;

  const borderColor = payload[0]?.color || 'var(--accent)';

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderLeft: `2px solid ${borderColor}`,
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-2) var(--space-3)',
      color: 'var(--ink)',
      fontSize: '0.78rem',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.18)',
    }}>
      <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{Math.round(label)}m</div>
      {payload.map(item => (
        <div key={item.dataKey} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', color: item.color }}>
          <span>{tooltipLabel(item.dataKey)}</span>
          <strong>{tooltipValue(item.dataKey, item.value, formatPace)}</strong>
        </div>
      ))}
    </div>
  );
}

function tooltipLabel(key) {
  if (key === 'pace_ms') return 'Pace';
  if (key === 'stroke_rate') return 'Rate';
  if (key === 'heart_rate') return 'HR';
  return key;
}

function tooltipValue(key, value, formatPace) {
  if (value == null) return '--';
  if (key === 'pace_ms') return formatPace(value);
  if (key === 'stroke_rate') return `${Number(value).toFixed(1)} s/m`;
  if (key === 'heart_rate') return `${Math.round(value)} bpm`;
  return value;
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

function buildSplitRows(workout) {
  if (!workout) return [];

  if (workout.intervals?.length > 0) {
    // Recoveries are keyed by work-rep ordinal (the rep whose end they measure).
    const recoveryByRep = new Map(
      (workout.recoveries || []).map(r => [r.rep_index, r.drop_bpm])
    );
    let workRep = 0;
    const rows = workout.intervals.map((interval, index) => {
      const isWork = interval.type !== 'rest';
      if (isWork) workRep += 1;
      return {
        key: `interval-${interval.id || index}`,
        label: `${index + 1}`,
        time_ms: interval.time_ms,
        pace_ms: interval.pace_ms,
        stroke_rate: interval.stroke_rate,
        heart_rate: interval.heart_rate_avg,
        calories: interval.calories,
        recovery_bpm: isWork ? recoveryByRep.get(workRep) ?? null : null,
        best: false,
      };
    });
    return markBest(rows);
  }

  const strokes = (workout.strokes || []).filter(s => s?.pace_ms > 0 && s?.distance_m >= 0);
  if (strokes.length < 2 || !workout.distance) return [];

  const splitSize = workout.distance <= 3000 ? 500 : 1000;
  const splitCount = Math.ceil(workout.distance / splitSize);
  const rows = [];

  for (let index = 0; index < splitCount; index += 1) {
    const start = index * splitSize;
    const end = Math.min((index + 1) * splitSize, workout.distance);
    const bucket = strokes.filter(stroke => stroke.distance_m >= start && stroke.distance_m <= end);
    if (bucket.length === 0) continue;

    const distance = end - start;
    const pace = average(bucket.map(stroke => stroke.pace_ms));
    rows.push({
      key: `distance-${index}`,
      label: `${start}-${end}m`,
      time_ms: pace ? (distance / 500) * pace : null,
      pace_ms: pace,
      stroke_rate: average(bucket.map(stroke => stroke.stroke_rate)),
      heart_rate: average(bucket.map(stroke => stroke.heart_rate)),
      best: false,
    });
  }

  return markBest(rows);
}

function markBest(rows) {
  const bestPace = Math.min(...rows.map(row => row.pace_ms).filter(Boolean));
  return rows.map(row => ({ ...row, best: row.pace_ms === bestPace }));
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(Number(value)) && Number(value) > 0);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function paceToWatts(paceMs) {
  if (!paceMs || paceMs <= 0) return null;
  const paceSeconds = paceMs / 1000;
  return Math.round(2.8 / Math.pow(paceSeconds / 500, 3));
}

function wattsToCalHr(watts) {
  if (!watts) return null;
  return Math.round(watts * 0.86 + 300);
}

function getPrimaryMetric(units) {
  if (units === 'watts') {
    return {
      averageLabel: 'Ave. Power',
      targetLabel: 'Target Power',
      chartLabel: 'Power',
      chartUnit: 'watt',
      unit: undefined,
    };
  }

  if (units === 'calhr') {
    return {
      averageLabel: 'Ave. Calories Per Hour',
      targetLabel: 'Target Calories Per Hour',
      chartLabel: 'Calories',
      chartUnit: 'cal/hr',
      unit: undefined,
    };
  }

  return {
    averageLabel: 'Ave. Pace',
    targetLabel: 'Target Pace',
    chartLabel: 'Pace',
    chartUnit: '/500m',
    unit: '/500m',
  };
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatClock(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatTimePrecise(timeMs) {
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

function formatDistanceNumber(meters) {
  if (!meters) return '--';
  return Math.round(meters).toLocaleString();
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

function signed(value) {
  if (value == null) return '--';
  const rounded = Math.round(Number(value));
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
