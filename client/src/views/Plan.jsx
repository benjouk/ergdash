import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { usePrefs } from '../context/PrefsContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { monthGrid, shiftMonth, monthLabel } from '../utils/planCalendar.js';
import MonthCalendar from '../components/Plan/MonthCalendar.jsx';
import WeekList from '../components/Plan/WeekList.jsx';
import DayPanel from '../components/Plan/DayPanel.jsx';
import ProgramCard from '../components/Plan/ProgramCard.jsx';
import ProgramBrowser from '../components/Plan/ProgramBrowser.jsx';
import PageHeader from '../components/PageHeader/PageHeader.jsx';
import styles from './Plan.module.css';

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export default function Plan() {
  const [searchParams] = useSearchParams();
  const paramDate = searchParams.get('date');
  const initialDate = paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) ? paramDate : isoToday();

  const today = isoToday();
  const [{ year, month }, setYearMonth] = useState(() => ({
    year: Number(initialDate.slice(0, 4)),
    month: Number(initialDate.slice(5, 7)) - 1,
  }));
  const { weekStart } = usePrefs();
  const { formatDistance, formatPace } = useUnits();

  const [plans, setPlans] = useState(null);
  const [actualDays, setActualDays] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [selectedDate, setSelectedDate] = useState(initialDate);

  const grid = useMemo(() => monthGrid(year, month, weekStart), [year, month, weekStart]);

  const load = useCallback(() => {
    api.getPlans({ from: grid.from, to: grid.to })
      .then(d => setPlans(d.plans || []))
      .catch(() => setPlans([]));
    api.getCalendar({ from: grid.from, to: grid.to })
      .then(d => setActualDays(d.days || []))
      .catch(() => setActualDays([]));
    api.getPrograms()
      .then(d => setPrograms(d.programs || []))
      .catch(() => setPrograms([]));
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

  const programsById = useMemo(() => new Map(programs.map(p => [p.id, p])), [programs]);
  const activeProgram = programs.find(p => p.status === 'active' || p.status === 'paused') || null;

  const dayPlans = plansByDay.get(selectedDate) || [];
  const dayActual = metersByDay.map.get(selectedDate);

  const goToday = () => {
    setYearMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
    setSelectedDate(today);
  };

  // Keep the selection inside the fetched month so the day panel never shows
  // a date whose plans/meters aren't loaded.
  const shiftBy = (delta) => {
    const next = shiftMonth(year, month, delta);
    setYearMonth(next);
    const firstOfMonth = `${next.year}-${String(next.month + 1).padStart(2, '0')}-01`;
    setSelectedDate(today.slice(0, 7) === firstOfMonth.slice(0, 7) ? today : firstOfMonth);
  };

  return (
    <div className={styles.plan}>
      <PageHeader
        title="Plan"
        subtitle="Schedule sessions and follow your training program."
        actions={<button type="button" className={styles.navButton} onClick={goToday}>Today</button>}
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

      <WeekList
        selectedDate={selectedDate}
        weekStart={weekStart}
        plansByDay={plansByDay}
        metersByDay={metersByDay}
        today={today}
        onSelectDate={setSelectedDate}
        formatDistance={formatDistance}
      />

      <MonthCalendar
        grid={grid}
        monthTitle={monthLabel(year, month)}
        onShiftMonth={shiftBy}
        plansByDay={plansByDay}
        metersByDay={metersByDay}
        selectedDate={selectedDate}
        today={today}
        onSelectDate={setSelectedDate}
        formatDistance={formatDistance}
        weekStart={weekStart}
      />

      {activeProgram && (
        <ProgramCard program={activeProgram} onChanged={load} />
      )}

      {!activeProgram && <ProgramBrowser onStarted={load} />}
    </div>
  );
}
