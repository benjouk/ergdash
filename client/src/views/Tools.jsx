import { useMemo, useState } from 'react';
import { Calculator, Clock3, Gauge, Zap } from 'lucide-react';
import { useUnits } from '../context/UnitsContext.jsx';
import {
  buildRacePlan,
  calHrToWatts,
  formatDuration,
  formatPaceSeconds,
  paceToWatts,
  parsePaceInput,
  parseTimeInput,
  wattsToCalHr,
  wattsToPace,
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

export default function Tools() {
  const { formatDistanceFull } = useUnits();
  const [paceSeconds, setPaceSeconds] = useState(120);
  const [paceInput, setPaceInput] = useState('2:00.0');
  const [wattsInput, setWattsInput] = useState(String(Math.round(paceToWatts(120))));
  const [calHrInput, setCalHrInput] = useState(String(Math.round(wattsToCalHr(paceToWatts(120)))));
  const [distance, setDistance] = useState(2000);
  const [customDistance, setCustomDistance] = useState('');
  const [targetTime, setTargetTime] = useState('8:00.0');

  const watts = paceToWatts(paceSeconds);
  const calHr = wattsToCalHr(watts);
  const targetDistance = customDistance ? Number(customDistance) : distance;
  const targetSeconds = parseTimeInput(targetTime);
  const racePlan = useMemo(() => (
    buildRacePlan(targetDistance, targetSeconds)
  ), [targetDistance, targetSeconds]);

  function setFromPace(value) {
    setPaceInput(value);
    const nextPace = parsePaceInput(value);
    if (!nextPace) return;

    const nextWatts = paceToWatts(nextPace);
    setPaceSeconds(nextPace);
    setWattsInput(String(Math.round(nextWatts)));
    setCalHrInput(String(Math.round(wattsToCalHr(nextWatts))));
  }

  function setFromWatts(value) {
    setWattsInput(value);
    const nextWatts = Number(value);
    const nextPace = wattsToPace(nextWatts);
    if (!nextPace) return;

    setPaceSeconds(nextPace);
    setPaceInput(formatPaceSeconds(nextPace));
    setCalHrInput(String(Math.round(wattsToCalHr(nextWatts))));
  }

  function setFromCalHr(value) {
    setCalHrInput(value);
    const nextWatts = calHrToWatts(value);
    const nextPace = wattsToPace(nextWatts);
    if (!nextWatts || !nextPace) return;

    setPaceSeconds(nextPace);
    setPaceInput(formatPaceSeconds(nextPace));
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
            <label className={styles.field}>
              <span><Clock3 size={14} /> Pace /500m</span>
              <input value={paceInput} onChange={event => setFromPace(event.target.value)} inputMode="decimal" />
            </label>
            <label className={styles.field}>
              <span><Zap size={14} /> Watts</span>
              <input value={wattsInput} onChange={event => setFromWatts(event.target.value)} inputMode="decimal" />
            </label>
            <label className={styles.field}>
              <span><Gauge size={14} /> Cal/hr</span>
              <input value={calHrInput} onChange={event => setFromCalHr(event.target.value)} inputMode="decimal" />
            </label>
          </div>

          <div className={styles.resultBand}>
            <span>{formatPaceSeconds(paceSeconds)}</span>
            <span>{Math.round(watts)} W</span>
            <span>{Math.round(calHr)} Cal/hr</span>
          </div>
        </section>

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
            <label className={styles.field}>
              <span>Target time</span>
              <input value={targetTime} onChange={event => setTargetTime(event.target.value)} inputMode="decimal" />
            </label>
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
                      <th>Split time</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {racePlan.splits.map(split => (
                      <tr key={split.index}>
                        <td>{split.index}</td>
                        <td>{formatDistanceFull(split.cumulativeDistance)}</td>
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
