/**
 * Demo project generator.
 *
 * V1 ships no binary sample assets: instead the demo paints a set of
 * plausible "photos" on a canvas and hands them to the normal import
 * pipeline as File objects, so the demo exercises exactly the same
 * analyse → group → layout → export path as real user files.
 *
 * Everything here is deterministic (seeded RNG, fixed timestamps), which
 * keeps the demo book byte-identical between runs.
 */

/** Long edge in px: ~253 DPI on a full-bleed A4 page, so no DPI warnings. */
export const LONG_EDGE = 2200;
const JPEG_QUALITY = 0.88;
/** 2026-07-11 07:00 local — fixed so grouping by time is reproducible. */
const BASE_TIME = new Date(2026, 6, 11, 7, 0, 0).getTime();


type SceneKind =
  | 'sea'
  | 'sky'
  | 'forest'
  | 'mountain'
  | 'city'
  | 'food'
  | 'desert'
  | 'portrait'
  | 'texture';

interface Scene {
  kind: SceneKind;
  /** width / height */
  aspect: number;
  /** Minutes after BASE_TIME; gaps over 3h split groups. */
  at: number;
  name: string;
}

export const SCENES: Scene[] = [

  { kind: 'sea', aspect: 3 / 2, at: 0, name: '清晨的海' },
  { kind: 'sea', aspect: 3 / 2, at: 6, name: '退潮' },
  { kind: 'sea', aspect: 2 / 3, at: 11, name: '灯塔' },
  { kind: 'sky', aspect: 3 / 2, at: 18, name: '云隙光' },
  { kind: 'sea', aspect: 16 / 9, at: 24, name: '长滩' },

  { kind: 'forest', aspect: 2 / 3, at: 260, name: '林间小路' },
  { kind: 'forest', aspect: 3 / 2, at: 266, name: '蕨与苔' },
  { kind: 'forest', aspect: 2 / 3, at: 271, name: '树影' },
  { kind: 'mountain', aspect: 3 / 2, at: 279, name: '远山' },
  { kind: 'mountain', aspect: 16 / 9, at: 288, name: '山脊线' },
  { kind: 'mountain', aspect: 2 / 3, at: 295, name: '一线天' },

  { kind: 'city', aspect: 2 / 3, at: 700, name: '傍晚的巷子' },
  { kind: 'city', aspect: 3 / 2, at: 706, name: '天台' },
  { kind: 'city', aspect: 3 / 2, at: 713, name: '亮起来的窗' },
  { kind: 'city', aspect: 2 / 3, at: 720, name: '霓虹' },
  { kind: 'food', aspect: 1, at: 726, name: '夜宵' },
  { kind: 'food', aspect: 1, at: 731, name: '第二碗' },

  { kind: 'desert', aspect: 3 / 2, at: 1500, name: '沙丘' },
  { kind: 'desert', aspect: 16 / 9, at: 1508, name: '风纹' },
  { kind: 'desert', aspect: 2 / 3, at: 1515, name: '独树' },
  { kind: 'sky', aspect: 3 / 2, at: 1523, name: '正午' },

  { kind: 'portrait', aspect: 2 / 3, at: 1900, name: '逆光' },
  { kind: 'portrait', aspect: 2 / 3, at: 1906, name: '侧脸' },
  { kind: 'texture', aspect: 1, at: 1914, name: '旧墙' },
];

export const DEMO_TEXT_BLOCKS = [
  '海边的第二个夏天',
  '出发那天下了一场很短的雨，我们在便利店门口等它停。',
  '第一天：海。潮水退得很远，沙上留下一层亮的壳。',
  '中途我们改了路线，从海边拐进山里，风一下子凉下来。',
  '第二天：山。雾在半山腰停着，像一条不会散的河。',
  '傍晚回到城里，巷子里的灯一盏一盏亮起来，热得让人想吃点什么。',
  '第三天：沙。地面烫，影子短，只有一棵树站在那儿。',
  '回程的车上谁都没说话。窗外的光一格一格扫过去，像在数这几天。这本册子就是那几天，按它自己的顺序排好的。',
];

const DEMO_TEXT = DEMO_TEXT_BLOCKS.join('\n\n');

/** Deterministic LCG — keeps the demo identical across runs and machines. */
function rng(seed: number): () => number {
  let state = (seed * 1103515245 + 12345) & 0x7fffffff;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function canvasOf(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function toJpeg(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
  });
}

/** Builds the demo file list: painted photos plus one text document. */
export async function buildDemoFiles(
  onProgress?: (done: number, total: number) => void,
): Promise<File[]> {
  const files: File[] = [];
  const total = SCENES.length;
  for (let i = 0; i < total; i += 1) {
    const scene = SCENES[i];
    const file = await paintScene(scene, i);
    if (file) files.push(file);
    onProgress?.(i + 1, total);
    // Yield so the progress label can repaint between images.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  files.push(
    new File([DEMO_TEXT], '海边的第二个夏天.txt', {
      type: 'text/plain',
      lastModified: BASE_TIME,
    }),
  );
  return files;
}

async function paintScene(scene: Scene, index: number): Promise<File | undefined> {
  const w = scene.aspect >= 1 ? LONG_EDGE : Math.round(LONG_EDGE * scene.aspect);
  const h = scene.aspect >= 1 ? Math.round(LONG_EDGE / scene.aspect) : LONG_EDGE;
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return undefined;

  paint(ctx as CanvasRenderingContext2D, scene, w, h, rng(index + 1));
  vignette(ctx as CanvasRenderingContext2D, w, h);

  const blob = await toJpeg(canvas);
  if (!blob) return undefined;
  const label = `${String(index + 1).padStart(2, '0')}-${scene.name}`;
  return new File([blob], `demo-${label}.jpg`, {
    type: 'image/jpeg',
    lastModified: BASE_TIME + scene.at * 60_000,
  });
}

function verticalGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  top: string,
  bottom: string,
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

type Painter = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  next: () => number,
) => void;

function paint(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  w: number,
  h: number,
  next: () => number,
): void {
  PAINTERS[scene.kind](ctx, w, h, next);
}

const PAINTERS: Record<SceneKind, Painter> = {
  sea: (ctx, w, h, next) => {
    const hue = 196 + next() * 14;
    verticalGradient(ctx, w, h, hsl(hue - 14, 52, 82), hsl(hue, 44, 62));
    const horizon = h * (0.40 + next() * 0.08);
    disc(ctx, w * (0.2 + next() * 0.6), horizon * 0.5, Math.min(w, h) * 0.07, 'rgba(255,250,235,0.92)');
    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, hsl(hue + 6, 46, 46));
    water.addColorStop(1, hsl(hue + 16, 52, 24));
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, h - horizon);
    for (let i = 0; i < 26; i += 1) {
      const y = horizon + (h - horizon) * Math.pow(next(), 0.6);
      ctx.fillStyle = `rgba(255,255,255,${0.05 + next() * 0.12})`;
      ctx.fillRect(w * next() * 0.7, y, w * (0.08 + next() * 0.3), Math.max(2, h * 0.004));
    }
    // Wet sand in the foreground.
    ctx.fillStyle = hsl(38, 26, 66);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.9);
    ctx.quadraticCurveTo(w * 0.5, h * (0.82 + next() * 0.06), w, h * 0.93);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  },

  sky: (ctx, w, h, next) => {
    const hue = 205 + next() * 12;
    verticalGradient(ctx, w, h, hsl(hue, 62, 46), hsl(hue - 24, 58, 84));
    disc(ctx, w * 0.72, h * 0.22, Math.min(w, h) * 0.1, 'rgba(255,248,220,0.95)');
    for (let i = 0; i < 9; i += 1) {
      const cx = w * next();
      const cy = h * (0.25 + next() * 0.6);
      const rx = w * (0.12 + next() * 0.2);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + next() * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, rx * (0.22 + next() * 0.14), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  forest: (ctx, w, h, next) => {
    const hue = 104 + next() * 22;
    verticalGradient(ctx, w, h, hsl(hue - 8, 44, 58), hsl(hue + 6, 46, 18));
    for (let i = 0; i < 14; i += 1) {
      const x = w * next();
      const width = w * (0.02 + next() * 0.05);
      const shade = 14 + next() * 16;
      ctx.fillStyle = hsl(hue + 10, 30, shade);
      ctx.fillRect(x, h * (next() * 0.2), width, h);
    }
    for (let i = 0; i < 5; i += 1) {
      const x = w * next();
      ctx.fillStyle = `rgba(255,255,225,${0.05 + next() * 0.1})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w * 0.14, 0);
      ctx.lineTo(x + w * (0.3 + next() * 0.2), h);
      ctx.lineTo(x + w * 0.18, h);
      ctx.closePath();
      ctx.fill();
    }
  },

  mountain: (ctx, w, h, next) => {
    const hue = 212 + next() * 16;
    verticalGradient(ctx, w, h, hsl(hue, 40, 78), hsl(hue - 6, 26, 92));
    const layers = 4;
    for (let layer = 0; layer < layers; layer += 1) {
      const base = h * (0.52 + layer * 0.12);
      ctx.fillStyle = hsl(hue + layer * 4, 22 + layer * 6, 62 - layer * 13);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, base);
      let x = 0;
      while (x < w) {
        const step = w * (0.14 + next() * 0.18);
        const peak = base - h * (0.08 + next() * 0.16);
        ctx.lineTo(x + step / 2, peak);
        ctx.lineTo(x + step, base + h * next() * 0.03);
        x += step;
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  },

  city: (ctx, w, h, next) => {
    const hue = 22 + next() * 16;
    verticalGradient(ctx, w, h, hsl(hue, 74, 62), hsl(262, 40, 16));
    let x = 0;
    while (x < w) {
      const bw = w * (0.06 + next() * 0.1);
      const bh = h * (0.2 + next() * 0.45);
      ctx.fillStyle = hsl(258, 26, 10 + next() * 8);
      ctx.fillRect(x, h - bh, bw, bh);
      const cols = Math.max(1, Math.floor(bw / (w * 0.028)));
      const rows = Math.max(2, Math.floor(bh / (h * 0.06)));
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (next() > 0.45) continue;
          ctx.fillStyle = `rgba(255,214,138,${0.5 + next() * 0.45})`;
          ctx.fillRect(
            x + bw * ((c + 0.3) / cols),
            h - bh + bh * ((r + 0.3) / rows),
            bw * 0.22,
            bh * 0.028,
          );
        }
      }
      x += bw * 1.08;
    }
  },

  food: (ctx, w, h, next) => {
    verticalGradient(ctx, w, h, hsl(28, 30, 34), hsl(24, 34, 22));
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + next() * 0.06})`;
      ctx.fillRect(0, h * next(), w, h * 0.02);
    }
    const r = Math.min(w, h) * 0.34;
    disc(ctx, w * 0.5, h * 0.54, r * 1.08, 'rgba(0,0,0,0.28)');
    disc(ctx, w * 0.5, h * 0.5, r, '#f6f2ea');
    disc(ctx, w * 0.5, h * 0.5, r * 0.74, hsl(28 + next() * 14, 56, 46));
    for (let i = 0; i < 12; i += 1) {
      const angle = next() * Math.PI * 2;
      const dist = r * 0.55 * next();
      disc(
        ctx,
        w * 0.5 + Math.cos(angle) * dist,
        h * 0.5 + Math.sin(angle) * dist,
        r * (0.05 + next() * 0.09),
        hsl(90 + next() * 30, 40, 40 + next() * 20),
      );
    }
  },

  desert: (ctx, w, h, next) => {
    verticalGradient(ctx, w, h, hsl(36, 68, 78), hsl(30, 58, 58));
    for (let layer = 0; layer < 4; layer += 1) {
      const base = h * (0.44 + layer * 0.14);
      ctx.fillStyle = hsl(34 - layer * 2, 52 - layer * 4, 74 - layer * 11);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, base + h * next() * 0.04);
      ctx.quadraticCurveTo(w * (0.3 + next() * 0.4), base - h * (0.06 + next() * 0.1), w, base + h * next() * 0.05);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    // Lone tree.
    const tx = w * (0.24 + next() * 0.5);
    const ty = h * 0.78;
    ctx.strokeStyle = hsl(26, 30, 22);
    ctx.lineWidth = Math.max(3, w * 0.008);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx, ty - h * 0.14);
    ctx.stroke();
    disc(ctx, tx, ty - h * 0.17, Math.min(w, h) * 0.05, hsl(96, 26, 30));
  },

  portrait: (ctx, w, h, next) => {
    const hue = 32 + next() * 14;
    const background = ctx.createRadialGradient(w * 0.6, h * 0.34, 0, w * 0.6, h * 0.34, Math.max(w, h) * 0.8);
    background.addColorStop(0, hsl(hue, 60, 82));
    background.addColorStop(1, hsl(hue - 12, 34, 44));
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    // Backlit silhouette: shoulders plus head, softened by an overlay.
    ctx.fillStyle = hsl(hue - 18, 24, 22);
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 1.02, w * 0.44, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    disc(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.17, hsl(hue - 18, 24, 24));
    const glow = ctx.createRadialGradient(w * 0.62, h * 0.3, 0, w * 0.62, h * 0.3, Math.min(w, h) * 0.6);
    glow.addColorStop(0, 'rgba(255,236,196,0.55)');
    glow.addColorStop(1, 'rgba(255,236,196,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  },

  texture: (ctx, w, h, next) => {
    verticalGradient(ctx, w, h, hsl(38, 12, 74), hsl(34, 10, 56));
    for (let i = 0; i < 220; i += 1) {
      ctx.fillStyle = `rgba(${next() > 0.5 ? 255 : 0},${next() > 0.5 ? 255 : 0},255,${0.02 + next() * 0.05})`;
      const size = w * (0.01 + next() * 0.06);
      ctx.fillRect(w * next(), h * next(), size, size * (0.3 + next()));
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = Math.max(2, w * 0.004);
    for (let i = -1; i < 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo((w * i) / 8, 0);
      ctx.lineTo((w * i) / 8 + w * 0.3, h);
      ctx.stroke();
    }
  },
};
