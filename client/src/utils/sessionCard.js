const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

// Surface spans 56..1144 horizontally; content sits 32px inside it on both ends.
const CONTENT_LEFT = 88;
const CONTENT_RIGHT = 1112;

const COLORS = {
  bg: '#111111',
  surface: '#191919',
  surfaceAlt: '#202020',
  ink: '#EAEAEA',
  ink2: '#8F8F8F',
  ink3: '#5A5A5A',
  rule: '#272727',
  brand: '#C9D93C',
  accent: '#AEC53F',
  accent2: '#6F9CC2',
  gold: '#C7A254',
};

const LABEL_FONT = '600 18px "IBM Plex Sans", system-ui, sans-serif';

export async function renderSessionCard(workout, formatters) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');

  const tagColor = workout.inferred_tag === 'interval' ? COLORS.accent2 : COLORS.accent;

  drawBackground(ctx);
  drawWordmark(ctx);
  drawMainStats(ctx, workout, formatters, tagColor);
  drawMeta(ctx, workout, formatters);
  drawPaceProfile(ctx, workout, formatters, tagColor);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not render session card'));
    }, 'image/png');
  });
}

function drawLabel(ctx, text, x, y, color = COLORS.ink2) {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = color;
  ctx.letterSpacing = '2px';
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

function drawBackground(ctx) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = COLORS.surface;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, CARD_HEIGHT - 128, 24);
  ctx.fill();

  ctx.fillStyle = COLORS.brand;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, 8, 4);
  ctx.fill();
}

function drawWordmark(ctx) {
  ctx.font = '700 42px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('Erg', CONTENT_LEFT, 136);
  const ergWidth = ctx.measureText('Erg').width;
  ctx.fillStyle = COLORS.brand;
  ctx.fillText('Dash', CONTENT_LEFT + ergWidth, 136);
}

function drawMainStats(ctx, workout, formatters, tagColor) {
  drawLabel(ctx, 'AVERAGE PACE', CONTENT_LEFT, 250);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '600 116px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText(formatters.formatPace(workout.pace_ms), CONTENT_LEFT - 4, 360);

  const tag = (workout.inferred_tag || 'endurance').toUpperCase();
  ctx.font = LABEL_FONT;
  ctx.letterSpacing = '2px';
  const pillWidth = ctx.measureText(tag).width + 40;
  const pillHeight = 38;
  const pillTop = 392;
  ctx.fillStyle = tagColor;
  roundRect(ctx, CONTENT_LEFT, pillTop, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.bg;
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, CONTENT_LEFT + 21, pillTop + pillHeight / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
}

function drawMeta(ctx, workout, formatters) {
  const date = new Date(workout.date);
  const items = [
    ['DISTANCE', formatters.formatDistanceFull(workout.distance)],
    ['TIME', formatters.formatTime(workout.time_ms)],
    ['DATE', date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
  ];

  const top = 492;
  const colWidth = 200;

  for (let index = 0; index < items.length; index += 1) {
    const [label, value] = items[index];
    const x = CONTENT_LEFT + index * colWidth;
    drawLabel(ctx, label, x, top, COLORS.ink3);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '600 32px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(value, x, top + 44);
  }
}

function drawPaceProfile(ctx, workout, formatters, lineColor) {
  const values = (workout.pace_profile || []).filter(value => value > 0);
  if (values.length < 2) return;

  const panel = { x: 664, y: 180, width: CONTENT_RIGHT - 664, height: 312 };
  const pad = 26;
  const plotLeft = panel.x + pad;
  const plotRight = panel.x + panel.width - pad;
  const plotTop = panel.y + 74;
  const plotBottom = panel.y + panel.height - 30;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.fillStyle = COLORS.surfaceAlt;
  roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 18);
  ctx.fill();

  drawLabel(ctx, 'PACE PROFILE', plotLeft, panel.y + 42, COLORS.ink2);

  // Best (fastest) split, right-aligned on the title row.
  const best = formatters.formatPace(min);
  ctx.font = '600 18px "IBM Plex Mono", ui-monospace, monospace';
  const bestWidth = ctx.measureText(best).width;
  ctx.fillStyle = lineColor;
  ctx.fillText(best, plotRight - bestWidth, panel.y + 42);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = COLORS.ink3;
  ctx.letterSpacing = '2px';
  const bestLabelWidth = ctx.measureText('BEST').width;
  ctx.fillText('BEST', plotRight - bestWidth - bestLabelWidth - 12, panel.y + 42);
  ctx.letterSpacing = '0px';

  // Slower pace (larger value) plots lower, so faster splits read as peaks.
  const points = values.map((value, index) => ({
    x: plotLeft + (index / (values.length - 1)) * (plotRight - plotLeft),
    y: plotTop + ((value - min) / range) * (plotBottom - plotTop),
  }));

  const fill = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
  fill.addColorStop(0, `${lineColor}2E`);
  fill.addColorStop(1, `${lineColor}00`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(points[0].x, plotBottom);
  points.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, plotBottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const gridY = plotTop + (i / 3) * (plotBottom - plotTop);
    ctx.beginPath();
    ctx.moveTo(plotLeft, gridY);
    ctx.lineTo(plotRight, gridY);
    ctx.stroke();
  }

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = COLORS.surfaceAlt;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5.5, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
