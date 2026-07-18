import { useEffect, useMemo, useState } from 'react';
import { Calculator, Clock3, Gauge, Scale, TrendingUp, Zap } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
import { distanceLabel } from '../components/PBBadge.jsx';
import {
  buildRacePlan,
  calHrToWatts,
  formatDuration,
  formatPaceSeconds,
  paceToWatts,
  wattsToCalHr,
  wattsToPace,
  weightAdjusted,
  weightFactor,
} from '../utils/ergMath.js';
import styles from './Tools.module.css';

const DISTANCE_PRESETS = [
  { label: '500', value: 500 },
  { label: '1k', value: 1000 },
  { label: '2k', value: 2000 },
  { label: '5k', value: 5000 },
  { label: '6k', value: 6000 },
  { label: '10k', value: 10000 },
];

const STRATEGY_OPTIONS = [
  { value: 'even', label: 'Even', hint: 'Hold one pace start to finish.' },
  { value: 'negative', label: 'Negative', hint: 'Start controlled, finish fast.' },
  { value: 'aggressive', label: 'Aggressive', hint: 'Fast start, hang on late.' },
];

// Native <select> wheels avoid needing a colon key on a mobile keypad.
const PACE_MINUTES = Array.from({ length: 10 }, (_, i) => i); // 0-9
const TARGET_MINUTES = Array.from({ length: 100 }, (_, i) => i); // 0-99
const SECONDS = Array.from({ length: 60 }, (_, i) => i); // 0-59

function splitClock(totalSeconds) {
  const rounded = Math.max(0, Math.round(Number(totalSeconds) || 0));
  return { minutes: Math.floor(rounded / 60), seconds: rounded % 60 };
}

function WeightAdjustCard() {
  const { weightKg } = usePrefs();
  const [weightInput, setWeightInput] = useState('');
  const [adjustDistance, setAdjustDistance] = useState('2000');
  const [adjustSeconds, setAdjustSeconds] = useState(420);

  // Settings weight arrives async; prefill until the user types their own.
  useEffect(() => {
    setWeightInput(current => current || (weightKg ? String(weightKg) : ''));
  }, [weightKg]);

  const factor = weightFactor(weightInput);
  const adjustedSeconds = weightAdjusted(adjustSeconds, weightInput);
  const distance = Number(adjustDistance);
  const adjustedPace = adjustedSeconds && distance > 0
    ? (adjustedSeconds / distance) * 500
    : null;
  const adjustParts = splitClock(adjustSeconds);

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.kicker}>Converter</span>
          <h3 className={styles.cardTitle}>Weight-adjusted score</h3>
        </div>
        <Scale size={20} className={styles.cardIcon} aria-hidden="true" />
      </div>

      <div className={styles.converterGrid}>
        <label className={styles.field}>
          <span><Scale size={14} /> Weight (kg)</span>
          <input
            value={weightInput}
            onChange={event => setWeightInput(event.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="75"
          />
        </label>
        <label className={styles.field}>
          <span>Distance (m)</span>
          <input
            value={adjustDistance}
            onChange={event => setAdjustDistance(event.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            placeholder="2000"
          />
        </label>
        <div className={styles.field}>
          <span id="adjust-time-label">Time</span>
          <div className={styles.timePicker} role="group" aria-labelledby="adjust-time-label">
            <select
              className={styles.timeSelect}
              aria-label="Time minutes"
              value={adjustParts.minutes}
              onChange={event => setAdjustSeconds(Number(event.target.value) * 60 + adjustParts.seconds)}
            >
              {TARGET_MINUTES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <span className={styles.timeColon} aria-hidden="true">:</span>
            <select
              className={styles.timeSelect}
              aria-label="Time seconds"
              value={adjustParts.seconds}
              onChange={event => setAdjustSeconds(adjustParts.minutes * 60 + Number(event.target.value))}
            >
              {SECONDS.map(value => (
                <option key={value} value={value}>{String(value).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {factor && adjustedSeconds ? (
        <div className={styles.resultBand}>
          <span>{formatDuration(adjustedSeconds)} adj</span>
          <span>{adjustedPace ? `${formatPaceSeconds(adjustedPace)} /500m` : '—'}</span>
          <span>×{factor.toFixed(3)}</span>
        </div>
      ) : (
        <div className={styles.empty}>
          Enter your weight and a result to see its Concept2 weight-corrected equivalent.
        </div>
      )}
    </section>
  );
}

// Current predicted time at every benchmark distance, from the same trend
// engine the Targets and Race Plan cards use. Distances without enough recent
// results get a ~pace-per-doubling estimate off the nearest trained distance.
function PredictedTimesCard() {
  const { formatTime, formatPace } = useUnits();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.getPredictedTimes()
      .then(d => { if (mounted) setData(d); })
      .catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, []);

  const rows = data?.predicted_times || [];
  const doublingS = data ? (data.pace_per_doubling_ms / 1000).toFixed(1) : null;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.kicker}>Prediction</span>
          <h3 className={styles.cardTitle}>Predicted times</h3>
        </div>
        <TrendingUp size={20} className={styles.cardIcon} aria-hidden="true" />
      </div>

      {rows.length > 0 ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.splitsTable}>
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>Predicted</th>
                  <th>/500m</th>
                  <th>vs PB</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.distance}>
                    <td>{distanceLabel(row.distance)}</td>
                    <td
                      title={row.source === 'trend'
                        ? `Projected from ${row.sample_size} recent hard ${distanceLabel(row.distance)} results`
                        : `Estimated from your ${distanceLabel(row.anchor_distance)} trend`}
                    >
                      {row.source === 'estimated' && '~'}{formatTime(row.predicted_time_ms)}
                    </td>
                    <td>{formatPace(row.pace_ms)}</td>
                    <td>{deltaVsPb(row.delta_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.cardNote}>
            Plain rows project your recent hard results at that distance to today.
            ~ rows are estimated from the nearest trained distance at {doublingS}s
            of split per doubling{data.doubling_source === 'fitted'
              ? ', fitted to your own results' : " (Paul's Law)"}.
          </p>
        </>
      ) : (
        <div className={styles.empty}>
          {failed
            ? 'Predictions are unavailable right now.'
            : data
              ? 'Row a few hard pieces at a benchmark distance and predictions will appear here.'
              : 'Loading…'}
        </div>
      )}
    </section>
  );
}

function deltaVsPb(deltaMs) {
  if (deltaMs == null) return '—';
  const seconds = Math.abs(deltaMs) / 1000;
  return `${deltaMs > 0 ? '+' : '-'}${seconds.toFixed(1)}s`;
}

export default function Tools() {
  const { formatDistanceFull } = useUnits();
  const [paceSeconds, setPaceSeconds] = useState(120);
  const [wattsInput, setWattsInput] = useState(String(Math.round(paceToWatts(120))));
  const [calHrInput, setCalHrInput] = useState(String(Math.round(wattsToCalHr(paceToWatts(120)))));
  const [distance, setDistance] = useState(2000);
  const [customDistance, setCustomDistance] = useState('');
  const [targetSeconds, setTargetSeconds] = useState(480);
  const [strategy, setStrategy] = useState('even');

  const watts = paceToWatts(paceSeconds);
  const calHr = wattsToCalHr(watts);
  const targetDistance = customDistance ? Number(customDistance) : distance;
  const paceParts = splitClock(paceSeconds);
  const targetParts = splitClock(targetSeconds);
  const racePlan = useMemo(() => (
    buildRacePlan(targetDistance, targetSeconds, 500, strategy)
  ), [targetDistance, targetSeconds, strategy]);

  function setPaceFromParts(minutes, seconds) {
    const total = minutes * 60 + seconds;
    setPaceSeconds(total);
    const nextWatts = paceToWatts(total);
    if (!nextWatts) return;
    setWattsInput(String(Math.round(nextWatts)));
    setCalHrInput(String(Math.round(wattsToCalHr(nextWatts))));
  }

  function setFromWatts(value) {
    setWattsInput(value);
    const nextWatts = Number(value);
    const nextPace = wattsToPace(nextWatts);
    if (!nextPace) return;

    setPaceSeconds(nextPace);
    setCalHrInput(String(Math.round(wattsToCalHr(nextWatts))));
  }

  function setFromCalHr(value) {
    setCalHrInput(value);
    const nextWatts = calHrToWatts(value);
    const nextPace = wattsToPace(nextWatts);
    if (!nextWatts || !nextPace) return;

    setPaceSeconds(nextPace);
    setWattsInput(String(Math.round(nextWatts)));
  }

  return (
    <div className={styles.tools}>
      <div className={styles.header}>
        <h2 className={styles.title}>Tools</h2>
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Converter</span>
              <h3 className={styles.cardTitle}>Pace ⇄ Watts ⇄ Cal/hr</h3>
            </div>
            <Calculator size={20} className={styles.cardIcon} aria-hidden="true" />
          </div>

          <div className={styles.converterGrid}>
            <div className={styles.field}>
              <span id="pace-label"><Clock3 size={14} /> Pace /500m</span>
              <div className={styles.timePicker} role="group" aria-labelledby="pace-label">
                <select
                  className={styles.timeSelect}
                  aria-label="Pace minutes"
                  value={paceParts.minutes}
                  onChange={event => setPaceFromParts(Number(event.target.value), paceParts.seconds)}
                >
                  {PACE_MINUTES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <span className={styles.timeColon} aria-hidden="true">:</span>
                <select
                  className={styles.timeSelect}
                  aria-label="Pace seconds"
                  value={paceParts.seconds}
                  onChange={event => setPaceFromParts(paceParts.minutes, Number(event.target.value))}
                >
                  {SECONDS.map(value => (
                    <option key={value} value={value}>{String(value).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className={styles.field}>
              <span><Zap size={14} /> Watts</span>
              <input value={wattsInput} onChange={event => setFromWatts(event.target.value)} inputMode="numeric" />
            </label>
            <label className={styles.field}>
              <span><Gauge size={14} /> Cal/hr</span>
              <input value={calHrInput} onChange={event => setFromCalHr(event.target.value)} inputMode="numeric" />
            </label>
          </div>

          <div className={styles.resultBand}>
            <span>{formatPaceSeconds(paceSeconds) || '—'}</span>
            <span>{watts ? `${Math.round(watts)} W` : '—'}</span>
            <span>{watts && calHr ? `${Math.round(calHr)} Cal/hr` : '—'}</span>
          </div>
        </section>

        <WeightAdjustCard />

        <PredictedTimesCard />

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Planner</span>
              <h3 className={styles.cardTitle}>Race pace planner</h3>
            </div>
            <Clock3 size={20} className={styles.cardIcon} aria-hidden="true" />
          </div>

          <div className={styles.presets} aria-label="Distance presets">
            {DISTANCE_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                className={`${styles.presetButton} ${!customDistance && distance === preset.value ? styles.presetButtonActive : ''}`}
                onClick={() => { setDistance(preset.value); setCustomDistance(''); }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className={styles.plannerFields}>
            <label className={styles.field}>
              <span>Custom metres</span>
              <input
                value={customDistance}
                onChange={event => setCustomDistance(event.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder={String(distance)}
              />
            </label>
            <div className={styles.field}>
              <span id="target-time-label">Target time</span>
              <div className={styles.timePicker} role="group" aria-labelledby="target-time-label">
                <select
                  className={styles.timeSelect}
                  aria-label="Target minutes"
                  value={targetParts.minutes}
                  onChange={event => setTargetSeconds(Number(event.target.value) * 60 + targetParts.seconds)}
                >
                  {TARGET_MINUTES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <span className={styles.timeColon} aria-hidden="true">:</span>
                <select
                  className={styles.timeSelect}
                  aria-label="Target seconds"
                  value={targetParts.seconds}
                  onChange={event => setTargetSeconds(targetParts.minutes * 60 + Number(event.target.value))}
                >
                  {SECONDS.map(value => (
                    <option key={value} value={value}>{String(value).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={styles.presets} role="group" aria-label="Pacing strategy">
            {STRATEGY_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`${styles.presetButton} ${strategy === option.value ? styles.presetButtonActive : ''}`}
                onClick={() => setStrategy(option.value)}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>

          {racePlan ? (
            <>
              <div className={styles.planSummary}>
                <span>{formatDistanceFull(racePlan.targetDistance)}</span>
                <strong>{formatPaceSeconds(racePlan.splitSeconds)}</strong>
                <span>/500m</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.splitsTable}>
                  <thead>
                    <tr>
                      <th>Split</th>
                      <th>Distance</th>
                      <th>Target /500m</th>
                      <th>Split time</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {racePlan.splits.map(split => (
                      <tr key={split.index}>
                        <td>{split.index}</td>
                        <td>{formatDistanceFull(split.cumulativeDistance)}</td>
                        <td>{formatPaceSeconds(split.paceSeconds)}</td>
                        <td>{formatDuration(split.splitTimeSeconds)}</td>
                        <td>{formatDuration(split.cumulativeTimeSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className={styles.empty}>Enter a valid distance and target time.</div>
          )}
        </section>
      </div>
    </div>
  );
}
