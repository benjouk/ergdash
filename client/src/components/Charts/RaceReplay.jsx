import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { sampleRacePlayback } from '../../utils/workoutComparison.js';
import styles from './RaceReplay.module.css';

const SPEEDS = [5, 10, 15, 30, 60, 120, 240];

// Aim to replay a piece in roughly this many seconds when picking the default
// speed. ~60s keeps a 2k around 10x (a 7-8 min row plays in ~45-50s) rather
// than the too-brisk 15x, while long pieces still auto-pick a faster speed.
const TARGET_PLAYBACK_S = 60;

// Head-to-head playback: a top-down two-lane course where each boat moves at
// the pace its session was actually rowed, on a shared accelerated clock.
// laneOne/laneTwo are { label, chip }; resultText and subControls let the solo
// (single-session vs pace boat) caller reword the outcome and add an opponent
// picker without duplicating the animation machinery.
export default function RaceReplay({ playback, laneOne, laneTwo, formatPace, resultText, subControls, photoFinishBand = 0.1 }) {
  const defaultSpeed = useMemo(
    () => SPEEDS.find(speed => playback.duration_s / speed <= TARGET_PLAYBACK_S) || SPEEDS[SPEEDS.length - 1],
    [playback],
  );
  const [speed, setSpeed] = useState(defaultSpeed);
  const [raceT, setRaceT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastTickRef = useRef(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const step = (now) => {
      if (lastTickRef.current != null) {
        const dt = ((now - lastTickRef.current) / 1000) * speedRef.current;
        setRaceT(prev => {
          const next = prev + dt;
          if (next >= playback.duration_s) {
            setPlaying(false);
            return playback.duration_s;
          }
          return next;
        });
      }
      lastTickRef.current = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      lastTickRef.current = null;
      cancelAnimationFrame(frame);
    };
  }, [playing, playback]);

  // Reset when the compared pair changes (e.g. Change / Swap).
  useEffect(() => {
    setRaceT(0);
    setPlaying(false);
  }, [playback]);

  const frame = useMemo(() => sampleRacePlayback(playback, raceT), [playback, raceT]);
  const atEnd = raceT >= playback.duration_s - 1e-3;
  const finishGapS = Math.abs(playback.boats[0].finish_s - playback.boats[1].finish_s);
  const winnerIsOne = playback.boats[0].finish_s <= playback.boats[1].finish_s;
  // A dead heat is essentially zero; a photo finish is any margin too close to
  // call at this precision (the band widens for solo pace-boat races, where the
  // typed pace can only differ from your own by rounding).
  const tie = finishGapS < 0.05;
  const photoFinish = finishGapS < photoFinishBand;
  const winnerLabel = winnerIsOne ? laneOne.label : laneTwo.label;
  const leaderLabel = Math.abs(frame.gap_m) < 1 ? null : frame.gap_m > 0 ? laneOne.label : laneTwo.label;
  const resultLabel = resultText
    ? resultText({ winnerIsOne, gapS: finishGapS, tie, photoFinish })
    : photoFinish ? 'Photo finish' : `${winnerLabel} wins by ${finishGapS.toFixed(1)}s`;

  const togglePlay = () => {
    if (atEnd) {
      setRaceT(0);
      setPlaying(true);
      return;
    }
    setPlaying(prev => !prev);
  };
  const cycleSpeed = () => setSpeed(prev => SPEEDS[(SPEEDS.indexOf(prev) + 1) % SPEEDS.length]);

  const tickStep = playback.distance > 3000 ? 1000 : 500;
  const ticks = [];
  for (let mark = tickStep; mark < playback.distance; mark += tickStep) ticks.push(mark);

  return (
    <section className={styles.card} aria-label="Race replay">
      <div className={styles.header}>
        <div className={styles.title}>Race replay</div>
        <div className={styles.controls}>
          <span className={styles.clock}>{formatClock(raceT)} / {formatClock(playback.duration_s)}</span>
          <input
            className={styles.scrub}
            type="range"
            min={0}
            max={playback.duration_s}
            step="any"
            value={raceT}
            aria-label="Race position"
            onChange={event => { setPlaying(false); setRaceT(Number(event.target.value)); }}
          />
          <button type="button" className={styles.controlButton} onClick={cycleSpeed} aria-label="Playback speed">
            {speed}x
          </button>
          <button type="button" className={styles.controlButton} onClick={() => { setPlaying(false); setRaceT(0); }} aria-label="Restart race">
            <RotateCcw size={13} />
          </button>
          <button type="button" className={`${styles.controlButton} ${styles.playButton}`} onClick={togglePlay} aria-label={playing ? 'Pause race' : 'Play race'}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Race'}
          </button>
        </div>
      </div>

      {subControls && <div className={styles.subHeader}>{subControls}</div>}

      <div className={styles.course}>
        <div className={styles.startLine} aria-hidden="true" />
        <div className={styles.markers}>
          {ticks.map(mark => (
            <div className={styles.marker} key={mark} style={{ left: `${(mark / playback.distance) * 100}%` }}>
              <span>{mark}m</span>
            </div>
          ))}
        </div>
        <Lane
          label={laneOne.label}
          chip={laneOne.chip}
          boat={frame.boats[0]}
          distance={playback.distance}
          tone={styles.laneOne}
        />
        <Lane
          label={laneTwo.label}
          chip={laneTwo.chip}
          boat={frame.boats[1]}
          distance={playback.distance}
          tone={styles.laneTwo}
        />
        <div className={styles.finishLine} aria-hidden="true" />
      </div>

      <div className={styles.statsRow}>
        <BoatStats boat={frame.boats[0]} formatPace={formatPace} align="left" />
        <div className={styles.raceStatus}>
          {frame.complete ? (
            <>
              <span className={styles.statusLabel}>Result</span>
              <strong>{resultLabel}</strong>
            </>
          ) : leaderLabel ? (
            <>
              <span className={styles.statusLabel}>Gap</span>
              <strong>{leaderLabel} +{Math.abs(frame.gap_m).toFixed(0)}m</strong>
            </>
          ) : (
            <>
              <span className={styles.statusLabel}>Gap</span>
              <strong>Level</strong>
            </>
          )}
        </div>
        <BoatStats boat={frame.boats[1]} formatPace={formatPace} align="right" />
      </div>
    </section>
  );
}

function Lane({ label, chip, boat, distance, tone }) {
  const pct = Math.min(100, (boat.distance_m / distance) * 100);
  return (
    <div className={`${styles.lane} ${tone}`}>
      <div className={styles.laneLabel}>
        {label}
        {chip && <span className={styles.laneChip}>{chip}</span>}
        {boat.finished && <span className={styles.finishChip}>{formatClock(boat.finish_s)}</span>}
      </div>
      <div className={styles.water}>
        <div className={styles.wake} style={{ width: `${pct}%` }} />
        <div className={styles.boat} style={{ left: `${pct}%` }} aria-hidden="true">
          <svg viewBox="0 0 56 12" width="56" height="12">
            <path d="M55 6 Q46 1 26 1 L6 1 Q1 1 1 6 Q1 11 6 11 L26 11 Q46 11 55 6 Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function BoatStats({ boat, formatPace, align }) {
  return (
    <div className={`${styles.boatStats} ${align === 'right' ? styles.boatStatsRight : ''}`}>
      <div><span>Dist</span><strong>{Math.round(boat.distance_m).toLocaleString()}m</strong></div>
      <div><span>Pace</span><strong>{boat.pace_ms != null ? formatPace(boat.pace_ms) : '—'}</strong></div>
      <div><span>Rate</span><strong>{boat.stroke_rate != null ? `${boat.stroke_rate.toFixed(1)}` : '—'}</strong></div>
      <div><span>HR</span><strong>{boat.heart_rate != null ? Math.round(boat.heart_rate) : '—'}</strong></div>
    </div>
  );
}

// Matches the session card's formatTime rounding so finish chips agree with
// the official times shown above the race.
function formatClock(seconds) {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
