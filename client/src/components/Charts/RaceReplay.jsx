import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { sampleRacePlayback } from '../../utils/workoutComparison.js';
import styles from './RaceReplay.module.css';

const SPEEDS = [30, 60, 120, 240];

// Head-to-head playback: a top-down two-lane course where each boat moves at
// the pace its session was actually rowed, on a shared accelerated clock.
export default function RaceReplay({ playback, date1, date2, formatPace }) {
  const defaultSpeed = useMemo(
    () => SPEEDS.find(speed => playback.duration_s / speed <= 45) || SPEEDS[SPEEDS.length - 1],
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
  const atEnd = raceT >= playback.duration_s;
  const finishGapS = Math.abs(playback.boats[0].finish_s - playback.boats[1].finish_s);
  const winnerDate = playback.boats[0].finish_s <= playback.boats[1].finish_s ? date1 : date2;
  const leader = Math.abs(frame.gap_m) < 1 ? null : frame.gap_m > 0 ? date1 : date2;

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
            step={playback.duration_s / 500}
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

      <div className={styles.course}>
        <div className={styles.markers}>
          {ticks.map(mark => (
            <div className={styles.marker} key={mark} style={{ left: `${(mark / playback.distance) * 100}%` }}>
              <span>{mark}m</span>
            </div>
          ))}
        </div>
        <Lane
          label={date1}
          chip="This session"
          boat={frame.boats[0]}
          distance={playback.distance}
          tone={styles.laneOne}
        />
        <Lane
          label={date2}
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
              <strong>{winnerDate} wins by {finishGapS.toFixed(1)}s</strong>
            </>
          ) : leader ? (
            <>
              <span className={styles.statusLabel}>Gap</span>
              <strong>{leader} leads by {Math.abs(frame.gap_m).toFixed(0)}m</strong>
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
            <path d="M1 6 Q10 1 30 1 L50 1 Q55 1 55 6 Q55 11 50 11 L30 11 Q10 11 1 6 Z" />
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

function formatClock(seconds) {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
