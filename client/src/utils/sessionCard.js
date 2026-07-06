const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const COLORS = {
  bg: '#0A0A0C',
  surface: '#141418',
  surface2: '#101014',
  surfaceAlt: '#1C1C21',
  ink: '#F2F2EF',
  inkSoft: '#D7D7D2',
  ink2: '#8E8E96',
  ink3: '#55555E',
  rule: '#26262C',
  accent: '#C3D500',
  accent2: '#38B6FF',
  gold: '#FFB000',
};

export async function renderSessionCard(workout, formatters) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawWordmark(ctx);
  drawMainStats(ctx, workout, formatters);
  drawMeta(ctx, workout, formatters);
  drawPaceProfile(ctx, workout);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not render session card'));
    }, 'image/png');
  });
}

function drawBackground(ctx) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glow = ctx.createRadialGradient(1030, 94, 0, 1030, 94, 480);
  glow.addColorStop(0, 'rgba(195, 213, 0, 0.18)');
  glow.addColorStop(0.42, 'rgba(195, 213, 0, 0.05)');
  glow.addColorStop(1, 'rgba(195, 213, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const panel = ctx.createLinearGradient(56, 64, 1144, 566);
  panel.addColorStop(0, '#17171B');
  panel.addColorStop(0.58, COLORS.surface);
  panel.addColorStop(1, '#101014');
  ctx.fillStyle = panel;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, CARD_HEIGHT - 128, 24);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, 56.5, 64.5, CARD_WIDTH - 113, CARD_HEIGHT - 129, 24);
  ctx.stroke();

  const accent = ctx.createLinearGradient(56, 64, 1144, 64);
  accent.addColorStop(0, COLORS.accent);
  accent.addColorStop(0.58, COLORS.accent);
  accent.addColorStop(1, '#E5F400');
  ctx.fillStyle = accent;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, 8, 4);
  ctx.fill();
}

function drawWordmark(ctx) {
  ctx.font = '900 42px Archivo, Outfit, system-ui, sans-serif';
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('Erg', 88, 132);
  ctx.fillStyle = COLORS.accent;
  ctx.fillText('Dash', 166, 132);

  ctx.fillStyle = COLORS.ink3;
  ctx.font = '800 14px Outfit, system-ui, sans-serif';
  ctx.fillText('CONCEPT2 SESSION', 90, 166);
}

function drawMainStats(ctx, workout, formatters) {
  ctx.fillStyle = COLORS.ink2;
  ctx.font = '800 22px Outfit, system-ui, sans-serif';
  ctx.letterSpacing = '0px';
  ctx.fillText('AVERAGE PACE / 500M', 88, 244);

  const pace = formatters.formatPace(workout.pace_ms);
  ctx.fillStyle = COLORS.accent;
  ctx.font = '900 112px Archivo, Outfit, system-ui, sans-serif';
  ctx.fillText(pace, 84, 348);

  const tag = workout.inferred_tag || 'endurance';
  const label = tag.toUpperCase();
  ctx.font = '800 18px Outfit, system-ui, sans-serif';
  const labelWidth = ctx.measureText(label).width + 38;
  const tagColor = tag === 'interval' ? COLORS.accent2 : COLORS.accent;
  ctx.fillStyle = tagColor;
  roundRect(ctx, 88, 382, labelWidth, 34, 8);
  ctx.fill();
  ctx.fillStyle = COLORS.bg;
  ctx.fillText(label, 107, 405);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  roundRect(ctx, 88, 430, 506, 8, 4);
  ctx.fill();
  ctx.fillStyle = tagColor;
  roundRect(ctx, 88, 430, Math.min(506, Math.max(86, labelWidth * 2.8)), 8, 4);
  ctx.fill();
}

function drawMeta(ctx, workout, formatters) {
  const date = new Date(workout.date);
  const items = [
    ['DISTANCE', formatters.formatDistanceFull(workout.distance)],
    ['TIME', formatters.formatTime(workout.time_ms)],
    ['DATE', date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
  ];

  const startX = 88;
  const top = 484;
  const colWidth = 250;

  for (let index = 0; index < items.length; index += 1) {
    const [label, value] = items[index];
    const x = startX + index * colWidth;
    ctx.fillStyle = COLORS.ink2;
    ctx.font = '800 17px Outfit, system-ui, sans-serif';
    ctx.fillText(label, x, top);
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '800 34px Archivo, Outfit, system-ui, sans-serif';
    ctx.fillText(value, x, top + 46);
  }
}

function drawPaceProfile(ctx, workout) {
  const values = (workout.pace_profile || []).filter(value => value > 0);
  if (values.length < 2) return;

  const x = 694;
  const y = 192;
  const width = 394;
  const height = 254;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const tagColor = workout.inferred_tag === 'interval' ? COLORS.accent2 : COLORS.accent;

  const chartBg = ctx.createLinearGradient(x - 24, y - 30, x + width + 24, y + height + 60);
  chartBg.addColorStop(0, '#202027');
  chartBg.addColorStop(1, COLORS.surface2);
  ctx.fillStyle = chartBg;
  roundRect(ctx, x - 24, y - 30, width + 48, height + 76, 20);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - 23.5, y - 29.5, width + 47, height + 75, 20);
  ctx.stroke();

  ctx.fillStyle = COLORS.ink2;
  ctx.font = '800 17px Outfit, system-ui, sans-serif';
  ctx.fillText('PACE PROFILE', x, y - 4);

  ctx.fillStyle = COLORS.ink3;
  ctx.font = '700 13px Outfit, system-ui, sans-serif';
  ctx.fillText('FAST', x + width - 34, y - 4);

  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const gridY = y + 36 + (i / 3) * height;
    ctx.beginPath();
    ctx.moveTo(x, gridY);
    ctx.lineTo(x + width, gridY);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  values.forEach((value, index) => {
    const pointX = x + (index / (values.length - 1)) * width;
    const pointY = y + 36 + ((value - min) / range) * height;
    if (index === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  });
  ctx.stroke();

  ctx.strokeStyle = tagColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  values.forEach((value, index) => {
    const pointX = x + (index / (values.length - 1)) * width;
    const pointY = y + 36 + ((value - min) / range) * height;
    if (index === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  });
  ctx.stroke();
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
