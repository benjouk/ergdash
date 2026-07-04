import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import CumulativeMetersChart from '../components/Charts/CumulativeMetersChart.jsx';
import EfficiencyChart from '../components/Charts/EfficiencyChart.jsx';
import DpsTrendChart from '../components/Charts/DpsTrendChart.jsx';
import PowerCurveChart from '../components/Charts/PowerCurveChart.jsx';
import ZoneStackChart from '../components/Charts/ZoneStackChart.jsx';
import HrDriftChart from '../components/Charts/HrDriftChart.jsx';
import RateDisciplineCard from '../components/Charts/RateDisciplineCard.jsx';
import DragFactorChart from '../components/Charts/DragFactorChart.jsx';
import FadeFingerprint from '../components/Charts/FadeFingerprint.jsx';
import PbTimelineChart from '../components/Charts/PbTimelineChart.jsx';

export const CHART_REGISTRY = [
  { id: 'fitness', title: 'Fitness / Fatigue / Form', component: FitnessChart, width: 'full' },
  { id: 'pace', title: 'Pace Trend', component: PaceChart, width: 'half' },
  { id: 'volume', title: 'Weekly Volume', component: VolumeChart, width: 'half' },
  { id: 'power-curve', title: 'Power Curve', component: PowerCurveChart, width: 'half' },
  { id: 'zones', title: 'Zone Stack', component: ZoneStackChart, width: 'half' },
  { id: 'cumulative-meters', title: 'Cumulative Metres', component: CumulativeMetersChart, width: 'half' },
  { id: 'drag-factor', title: 'Drag Factor', component: DragFactorChart, width: 'half' },
  { id: 'efficiency', title: 'Efficiency', component: EfficiencyChart, width: 'half' },
  { id: 'dps-trend', title: 'Distance Per Stroke', component: DpsTrendChart, width: 'half' },
  { id: 'hr-drift', title: 'HR Drift', component: HrDriftChart, width: 'half' },
  { id: 'rate-discipline', title: 'Rate Discipline', component: RateDisciplineCard, width: 'half' },
  { id: 'pb_timeline', title: 'PB Progression', component: PbTimelineChart, width: 'half' },
  { id: 'fade', title: 'Fade Fingerprint', component: FadeFingerprint, width: 'full' },
];

export const DEFAULT_LAYOUT = {
  version: 1,
  charts: CHART_REGISTRY.map(({ id }) => ({ id, hidden: false })),
};
