import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { buildSoloRacePlayback } from '../../utils/workoutComparison.js';
import RaceReplay from './RaceReplay.jsx';
import styles from './RaceReplay.module.css';

// Race a single session against a pace boat: an even split of its own average,
// a previous personal best at the distance, or a pace the user types in.
export default function SoloRaceReplay({ workout, formatPace }) {
  const [kind, setKind] = useState('even');
  const [customPace, setCustomPace] = useState(() => formatPace(workout.pace_ms));
  const [pb, setPb] = useState(null);
  const lastCustomMs = useRef(workout.pace_ms);

  const tag = workout.inferred_tag === 'interval' ? 'interval' : 'endurance';

  useEffect(() => {
    let active = true;
    api.getPersonalBests()
      .then(data => {
        if (!active) return;
        const match = (data.personal_bests || []).find(
          entry => entry.distance === workout.distance && entry.tag === tag,
        );
        setPb(match || null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [workout.distance, tag]);

  // A PB you can race is a *previous* best, not this very session.
  const pbRaceable = pb && pb.workout_id !== workout.id;

  const parsedCustom = parsePaceToMs(customPace);
  if (parsedCustom != null) lastCustomMs.current = parsedCustom;

  const { paceMs, label } = useMemo(() => {
    if (kind === 'pb' && pbRaceable) return { paceMs: pb.pace_ms, label: `PB ${formatMs(pb.time_ms)}` };
    if (kind === 'custom') return { paceMs: lastCustomMs.current, label: `Target ${customPace}` };
    return { paceMs: workout.pace_ms, label: 'Even pace' };
  }, [kind, pbRaceable, pb, customPace, parsedCustom, workout.pace_ms]);

  const playback = useMemo(() => buildSoloRacePlayback(workout, { paceMs }), [workout, paceMs]);
  if (!playback) return null;

  const oppShort = kind === 'pb' && pbRaceable ? 'your PB' : kind === 'custom' ? 'target' : 'even pace';
  const resultText = ({ winnerIsOne, gapS, tie }) => {
    if (kind === 'even' || tie) return kind === 'even' ? 'Matched your even split' : 'Dead heat';
    return winnerIsOne ? `You beat ${oppShort} by ${gapS.toFixed(1)}s` : `${oppShort} beat you by ${gapS.toFixed(1)}s`;
  };

  const subControls = (
    <>
      <span className={styles.opponentLabel}>Race against</span>
      <div className={styles.segmented} role="group" aria-label="Race opponent">
        <button type="button" className={kind === 'even' ? styles.segmentActive : ''} onClick={() => setKind('even')}>Even pace</button>
        <button
          type="button"
          className={kind === 'pb' ? styles.segmentActive : ''}
          onClick={() => setKind('pb')}
          disabled={!pbRaceable}
          title={pbRaceable ? `Previous best: ${formatMs(pb.time_ms)}` : pb ? 'This session is your PB' : 'No previous best at this distance'}
        >
          PB
        </button>
        <button type="button" className={kind === 'custom' ? styles.segmentActive : ''} onClick={() => setKind('custom')}>Custom</button>
      </div>
      {kind === 'custom' && (
        <label className={styles.paceInput}>
          <input
            value={customPace}
            onChange={event => setCustomPace(event.target.value)}
            aria-label="Target pace per 500m"
            spellCheck={false}
            style={parsedCustom == null ? { borderColor: 'var(--negative)' } : undefined}
          />
          <span>/500m</span>
        </label>
      )}
    </>
  );

  return (
    <RaceReplay
      playback={playback}
      laneOne={{ label: 'You', chip: formatDate(workout.date) }}
      laneTwo={{ label }}
      formatPace={formatPace}
      resultText={resultText}
      subControls={subControls}
    />
  );
}

function parsePaceToMs(value) {
  const match = /^(\d+):(\d{1,2}(?:\.\d)?)$/.exec(String(value).trim());
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  const ms = Math.round((Number(match[1]) * 60 + seconds) * 1000);
  return ms >= 60000 && ms <= 300000 ? ms : null;
}

function formatMs(ms) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
