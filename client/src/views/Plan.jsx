import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { usePrefs } from '../context/PrefsContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { monthGrid, shiftMonth, monthLabel } from '../utils/planCalendar.js';
import MonthCalendar from '../components/Plan/MonthCalendar.jsx';
import WeekStrip from '../components/Plan/WeekStrip.jsx';
import DayPanel from '../components/Plan/DayPanel.jsx';
import styles from './Plan.module.css';

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export default function Plan() {
  const today = isoToday();
  const [{ year, month }, setYearMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const { weekStart } = usePrefs();
  const { formatDistance, formatPace } = useUnits();

  const [plans, setPlans] = useState(null);
  const [actualDays, setActualDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(today);

  const grid = useMemo(() => monthGrid(year, month, weekStart), [year, month, weekStart]);

  const load = useCallback(() => {
    api.getPlans({ from: grid.from, to: grid.to })
      .then(d => setPlans(d.plans || []))
      .catch(() => setPlans([]));
    api.getCalendar({ from: grid.from, to: grid.to })
      .then(d => setActualDays(d.days || []))
      .catch(() => setActualDays([]));
  }, [grid.from, grid.to]);

  useEffect(() => { load(); }, [load]);

  const plansByDay = useMemo(() => {
    const map = new Map();
    for (const p of plans || []) {
      if (!map.has(p.date)) map.set(p.date, []);
      map.get(p.date).push(p);
    }
    return map;
  }, [plans]);

  const metersByDay = useMemo(() => {
    const map = new Map(actualDays.map(d => [d.date, d]));
    const max = Math.max(1, ...actualDays.map(d => d.meters));
    return { map, max };
  }, [actualDays]);

  const linkedWorkoutIds = useMemo(
    () => new Set((plans || []).map(p => p.completed_workout_id).filter(Boolean)),
    [plans],
  );

  // Programs are wired in a later phase; an empty map keeps PlanRow badges off.
  const programsById = useMemo(() => new Map(), []);

  const dayPlans = plansByDay.get(selectedDate) || [];
  const dayActual = metersByDay.map.get(selectedDate);

  const goToday = () => {
    setYearMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
    setSelectedDate(today);
  };

  return (
    <div className={styles.plan}>
      <div className={styles.header}>
        <h2 className={styles.title}>Plan</h2>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous month"
            onClick={() => setYearMonth(shiftMonth(year, month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className={styles.monthLabel}>{monthLabel(year, month)}</span>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Next month"
            onClick={() => setYearMonth(shiftMonth(year, month, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <button type="button" className={styles.navButton} onClick={goToday}>Today</button>
        </div>
      </div>

      <MonthCalendar
        grid={grid}
        plansByDay={plansByDay}
        metersByDay={metersByDay}
        selectedDate={selectedDate}
        today={today}
        onSelectDate={setSelectedDate}
        formatDistance={formatDistance}
        weekStart={weekStart}
      />

      <WeekStrip
        selectedDate={selectedDate}
        weekStart={weekStart}
        plansByDay={plansByDay}
        metersByDay={metersByDay}
        today={today}
        onSelectDate={setSelectedDate}
        formatDistance={formatDistance}
      />

      <DayPanel
        date={selectedDate}
        plans={dayPlans}
        dayActual={dayActual}
        linkedWorkoutIds={linkedWorkoutIds}
        programsById={programsById}
        onChanged={load}
        formatDistance={formatDistance}
        formatPace={formatPace}
      />
    </div>
  );
}
