import { useEffect, useMemo, useState } from 'react';
import { Calculator, Clock3, Gauge, Scale, Zap } from 'lucide-react';
import { useUnits } from '../context/UnitsContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
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
import PageHeader from '../components/PageHeader/PageHeader.jsx';
import Eyebrow from '../components/Eyebrow/Eyebrow.jsx';
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
          <Eyebrow>Converter</Eyebrow>
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
      <PageHeader
        title="Tools"
        subtitle="Calculators for pace, power, and race planning."
      />

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Eyebrow>Converter</Eyebrow>
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

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Eyebrow>Planner</Eyebrow>
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
