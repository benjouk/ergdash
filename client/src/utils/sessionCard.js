const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const COLORS = {
  bg: '#0A0A0C',
  surface: '#141418',
  surfaceAlt: '#1C1C21',
  ink: '#F2F2EF',
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

  ctx.fillStyle = COLORS.surface;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, CARD_HEIGHT - 128, 24);
  ctx.fill();

  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, 56, 64, CARD_WIDTH - 112, 8, 4);
  ctx.fill();
}

function drawWordmark(ctx) {
  ctx.font = '900 42px Archivo, Outfit, system-ui, sans-serif';
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('ROW', 88, 132);
  ctx.fillStyle = COLORS.accent;
  ctx.fillText('//', 174, 132);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('DASH', 222, 132);
}

function drawMainStats(ctx, workout, formatters) {
  ctx.fillStyle = COLORS.ink3;
  ctx.font = '800 22px Outfit, system-ui, sans-serif';
  ctx.letterSpacing = '0px';
  ctx.fillText('AVERAGE PACE', 88, 250);

  ctx.fillStyle = COLORS.accent;
  ctx.font = '900 112px Archivo, Outfit, system-ui, sans-serif';
  ctx.fillText(formatters.formatPace(workout.pace_ms), 84, 355);

  const tag = workout.inferred_tag || 'endurance';
  const labelWidth = ctx.measureText(tag.toUpperCase()).width + 38;
  ctx.fillStyle = tag === 'interval' ? COLORS.accent2 : COLORS.accent;
  roundRect(ctx, 88, 388, labelWidth, 34, 6);
  ctx.fill();
  ctx.fillStyle = COLORS.bg;
  ctx.font = '800 18px Outfit, system-ui, sans-serif';
  ctx.fillText(tag.toUpperCase(), 107, 411);
}

function drawMeta(ctx, workout, formatters) {
  const date = new Date(workout.date);
  const items = [
    ['DISTANCE', formatters.formatDistanceFull(workout.distance)],
    ['TIME', formatters.formatTime(workout.time_ms)],
    ['DATE', date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
  ];

  const startX = 88;
  const top = 486;
  const colWidth = 250;

  for (let index = 0; index < items.length; index += 1) {
    const [label, value] = items[index];
    const x = startX + index * colWidth;
    ctx.fillStyle = COLORS.ink3;
    ctx.font = '800 17px Outfit, system-ui, sans-serif';
    ctx.fillText(label, x, top);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '800 34px Archivo, Outfit, system-ui, sans-serif';
    ctx.fillText(value, x, top + 46);
  }
}

function drawPaceProfile(ctx, workout) {
  const values = (workout.pace_profile || []).filter(value => value > 0);
  if (values.length < 2) return;

  const x = 700;
  const y = 214;
  const width = 372;
  const height = 230;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.fillStyle = COLORS.surfaceAlt;
  roundRect(ctx, x - 24, y - 28, width + 48, height + 70, 18);
  ctx.fill();

  ctx.fillStyle = COLORS.ink3;
  ctx.font = '800 17px Outfit, system-ui, sans-serif';
  ctx.fillText('PACE PROFILE', x, y - 2);

  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const gridY = y + 36 + (i / 3) * height;
    ctx.beginPath();
    ctx.moveTo(x, gridY);
    ctx.lineTo(x + width, gridY);
    ctx.stroke();
  }

  ctx.strokeStyle = workout.inferred_tag === 'interval' ? COLORS.accent2 : COLORS.accent;
  ctx.lineWidth = 5;
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
