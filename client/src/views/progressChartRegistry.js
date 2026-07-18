import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import CumulativeMetersChart from '../components/Charts/CumulativeMetersChart.jsx';
import EfficiencyChart from '../components/Charts/EfficiencyChart.jsx';
import DpsTrendChart from '../components/Charts/DpsTrendChart.jsx';
import PowerCurveChart from '../components/Charts/PowerCurveChart.jsx';
import ZoneStackChart from '../components/Charts/ZoneStackChart.jsx';
import HrDriftChart from '../components/Charts/HrDriftChart.jsx';
import StrokeQualityCard from '../components/Charts/StrokeQualityCard.jsx';
import DragFactorChart from '../components/Charts/DragFactorChart.jsx';
import FadeFingerprint from '../components/Charts/FadeFingerprint.jsx';
import PbTimelineChart from '../components/Charts/PbTimelineChart.jsx';
import PlanAdherenceChart from '../components/Charts/PlanAdherenceChart.jsx';

// Display sections for the Progress page, in render order. Every chart
// belongs to one group; user reordering applies within a group.
export const CHART_GROUPS = [
  { id: 'load', label: 'Training Load' },
  { id: 'speed', label: 'Speed & Racing' },
  { id: 'technique', label: 'Technique & Efficiency' },
  { id: 'plan', label: 'Plan' },
];

export const CHART_REGISTRY = [
  { id: 'fitness', title: 'Fitness / Fatigue / Form', component: FitnessChart, width: 'full', group: 'load' },
  { id: 'pace', title: 'Pace Trend', component: PaceChart, width: 'half', group: 'speed' },
  // Volume lives on the Dashboard; hidden here by default to avoid showing
  // the same chart on both pages, but available via Edit layout.
  { id: 'volume', title: 'Weekly Volume', component: VolumeChart, width: 'half', defaultHidden: true, group: 'load' },
  { id: 'power-curve', title: 'Power Curve', component: PowerCurveChart, width: 'half', group: 'speed' },
  { id: 'zones', title: 'Zone Stack', component: ZoneStackChart, width: 'half', group: 'load' },
  { id: 'cumulative-meters', title: 'Cumulative Metres', component: CumulativeMetersChart, width: 'half', group: 'load' },
  { id: 'drag-factor', title: 'Drag Factor', component: DragFactorChart, width: 'half', group: 'technique' },
  { id: 'efficiency', title: 'Efficiency', component: EfficiencyChart, width: 'half', group: 'technique' },
  { id: 'dps-trend', title: 'Distance Per Stroke', component: DpsTrendChart, width: 'half', group: 'technique' },
  { id: 'hr-drift', title: 'HR Drift', component: HrDriftChart, width: 'half', group: 'technique' },
  { id: 'stroke-quality', title: 'Stroke Quality', component: StrokeQualityCard, width: 'half', group: 'technique' },
  { id: 'pb_timeline', title: 'PB Progression', component: PbTimelineChart, width: 'half', group: 'speed' },
  { id: 'plan_adherence', title: 'Plan Adherence', component: PlanAdherenceChart, width: 'half', group: 'plan' },
  { id: 'fade', title: 'Fade Fingerprint', component: FadeFingerprint, width: 'full', group: 'speed' },
];

export const DEFAULT_LAYOUT = {
  version: 1,
  charts: CHART_REGISTRY.map(({ id, defaultHidden }) => ({ id, hidden: Boolean(defaultHidden) })),
};
