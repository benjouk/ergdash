import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { buildSoloRacePlayback } from '../../utils/workoutComparison.js';
import RaceReplay from './RaceReplay.jsx';
import styles from './RaceReplay.module.css';

// Race a single session against a pace boat: an even split of its own average,
// a previous personal best at the distance, or a pace the user types in.
export default function SoloRaceReplay({ workout, formatPace }) {
  const [kind, setKind] = useState('even');
  // The "/500m" target input is always a pace, so seed and parse it in
  // canonical m:ss.s regardless of the user's display units (formatPace can
  // emit watts or Cal/hr). formatPace stays for the read-only stat readouts.
  const [customPace, setCustomPace] = useState(() => formatPaceMs(workout.pace_ms));
  const [pb, setPb] = useState(null);
  const lastCustomMs = useRef(workout.pace_ms);

  const tag = workout.inferred_tag === 'interval' ? 'interval' : 'endurance';

  useEffect(() => {
    let active = true;
    api.getPersonalBests()
      .then(data => {
        if (!active) return;
        // Match on the nearest same-tag PB rather than an exact metre count: a
        // monitor records a couple of metres past the scored line, so a "2k" row
        // often stores 2,006m and would never equal the 2,000m PB. Standard PB
        // distances sit >=2x apart, so a 5% window (the same 1,900-2,100m band
        // the Workouts filter calls a 2k) resolves the distance without ever
        // conflating 1k/2k/5k.
        const match = (data.personal_bests || [])
          .filter(entry => entry.tag === tag && isNearDistance(entry.distance, workout.distance))
          .sort((a, b) => Math.abs(a.distance - workout.distance) - Math.abs(b.distance - workout.distance))[0];
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
  const resultText = ({ winnerIsOne, gapS, photoFinish }) => {
    if (kind === 'even') return 'Matched your even split';
    // Keep the exact margin visible, but frame a sub-second gap as the photo
    // finish it is - typing your own (rounded) pace can only differ by a hair.
    if (photoFinish) return `Photo finish · ${winnerIsOne ? 'you' : oppShort} by ${gapS.toFixed(1)}s`;
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
          title={pbRaceable ? `Previous best: ${formatMs(pb.time_ms)}` : pb ? 'This session is your PB - nothing to chase' : 'No personal best at this distance yet'}
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
      photoFinishBand={0.5}
    />
  );
}

// True when a session sits within 5% of a standard PB distance - enough to
// absorb the few metres a monitor logs past the line, tight enough to keep the
// widely spaced standard distances (500/1k/2k/5k/...) from ever overlapping.
export function isNearDistance(pbDistance, sessionDistance) {
  if (!(pbDistance > 0) || !(sessionDistance > 0)) return false;
  return Math.abs(pbDistance - sessionDistance) <= pbDistance * 0.05;
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

// Canonical pace per 500m (m:ss.s), unit-independent - mirrors the pace branch
// of UnitsContext.formatPace so a round-trip through parsePaceToMs is stable.
function formatPaceMs(ms) {
  if (!(ms > 0)) return '';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
