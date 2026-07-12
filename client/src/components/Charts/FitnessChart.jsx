import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

export default function FitnessChart({ compact = false }) {
  const { from: rangeFrom, to: rangeTo } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = {};
    if (rangeFrom) params.from = rangeFrom;
    if (rangeTo) params.to = rangeTo;
    return api.getFitness(params).then(d => {
      const rows = d.fitness_log || [];
      return compact ? rows.slice(-30) : rows;
    });
  }, [compact, rangeFrom, rangeTo]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Fitness / Fatigue / Form" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length === 0) return <ChartEmpty title="Fitness / Fatigue / Form" />;

  const height = compact ? 80 : 240;
  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Fitness / Fatigue / Form
        </div>
        <div className={styles.chartValue}>
          {latest.fitness.toFixed(1)}
          <span className={styles.chartValueUnit}>fitness</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data}>
          {!compact && (
            <>
              <XAxis
                dataKey="date"
                tick={AXIS_TICK}
                tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={35}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                formatter={(v, name) => [v.toFixed(1), name]}
              />
            </>
          )}
          <ReferenceLine y={0} stroke="var(--chart-grid)" />
          <Area type="monotone" dataKey="fitness" stroke={SERIES.primary} fill={SERIES.primaryBg} strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="fatigue" stroke={SERIES.hr} fill={SERIES.hrBg} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="form" stroke={SERIES.secondary} fill={SERIES.secondaryBg} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    
      <ChartInfo>Modelled from your training load. Fitness builds slowly with consistent volume, fatigue rises quickly after hard days, and form (fitness minus fatigue) shows freshness. Above zero means ready to perform.</ChartInfo>
    </div>
  );
}
