/**
 * Effects and game feel: sparks, dust, splashes, cracks, debris, hit flash, afterimages, screen
 * shake. View only: built from the sim's per-frame event list, never changes the sim. Uses its own
 * (unseeded) randomness; the view is not part of determinism. Everything is drawn in whole pixels.
 */
import type { CombatEvent, CombatSim } from '../combat/combat_sim';
import type { Camera } from './camera';
import { FLOOR_Y } from './camera';

const MAX_PARTICLES = 200;

const COL = {
  white: '#ffffff',
  paleGold: '#f2dc9b',
  gold: '#b8963e',
  blockBlue: '#cfe3ff',
  grit: '#6b5a48',
  water: '#7fb3cf',
  waterDark: '#3d6077',
  dust: '#8a8478',
  stone: '#4a4656',
  stoneLight: '#6c6778',
  crack: '#0b0a0f',
  metal: '#b8b0a0',
  counter: '#ffe08a',
} as const;

interface Particle {
  x: number;
  y: number; // world px, y up
  vx: number;
  vy: number;
  g: number;
  life: number;
  color: string;
  size: number;
  /** Debris: bounces and rolls on the floor. */
  bounce: boolean;
}

type SparkKind = 'streak' | 'burst' | 'block' | 'launch' | 'ring' | 'text';

interface Spark {
  kind: SparkKind;
  x: number;
  y: number;
  dir: number; // attacker facing
  t: number;
  max: number;
  scale: number;
  w?: number;
  h?: number;
}

interface Crack {
  x: number;
  y: number;
  side: number; // which way the wall faces: 1 = wall on the left
  t: number;
  seed: number;
}

interface Ghost {
  cell: number;
  x: number;
  y: number;
  facing: number;
}

export interface Afterimage extends Ghost {
  alpha: number;
  color: string;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const irnd = (a: number, b: number) => Math.floor(rnd(a, b + 1));

export class Effects {
  private particles: Particle[] = [];
  private sparks: Spark[] = [];
  private cracks: Crack[] = [];
  private flashUntil = [0, 0];
  private frame = 0;
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeLen = 1;
  /** Recent sprite positions per fighter (for phase-step afterimages). */
  private trail: Ghost[][] = [[], []];
  private ghostsLeft = [0, 0];
  /** Frames since the KO event (null = no KO yet). */
  koFrames: number | null = null;

  /** Call once per sim step, after sim.step(). `readEvents` false = the sim is frozen (e.g. the victory freeze). */
  onStep(sim: CombatSim, readEvents = true): void {
    this.frame++;
    if (readEvents) for (const e of sim.events) this.onEvent(e, sim);
    if (this.koFrames !== null) this.koFrames++;
    // Particles.
    for (const p of this.particles) {
      p.vy -= p.g;
      p.x += p.vx;
      p.y += p.vy;
      if (p.bounce && p.y <= 0) {
        p.y = 0;
        p.vy = -p.vy * 0.35;
        p.vx *= 0.8;
      }
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && (p.bounce || p.y > -4));
    for (const s of this.sparks) s.t++;
    this.sparks = this.sparks.filter((s) => s.t < s.max);
    for (const c of this.cracks) c.t++;
    this.cracks = this.cracks.filter((c) => c.t < 120);
    if (this.shakeLeft > 0) this.shakeLeft--;
    for (let i = 0; i < 2; i++) {
      const f = sim.fighters[i]!;
      if (f.state === 'phase_step') this.ghostsLeft[i] = 10;
      else if (this.ghostsLeft[i]! > 0) this.ghostsLeft[i]!--;
    }
  }

  private onEvent(e: CombatEvent, sim: CombatSim): void {
    const x = e.x / 100;
    const y = e.y / 100;
    const dir = sim.fighters[e.attacker]?.facing ?? 1;
    const def = sim.fighters[e.defender]!;
    switch (e.type) {
      case 'hit':
      case 'counter_hit': {
        const big = e.type === 'counter_hit' ? 1.6 : 1;
        this.flashUntil[e.defender] = this.frame + 2;
        if (e.height === 'high') this.spark('streak', x, y, dir, 9, big);
        else if (e.height === 'low') this.spray(x, y, dir, big);
        else this.spark('burst', x, y, dir, 9, big);
        if (e.type === 'counter_hit') this.spark('text', def.x / 100, def.y / 100 + def.height / 100 + 10, dir, 30, 1);
        if (e.damage >= 20) this.startShake(2, 8);
        break;
      }
      case 'ground_hit':
        this.flashUntil[e.defender] = this.frame + 2;
        this.spray(x, y, dir, 1);
        break;
      case 'block':
        this.spark('block', x, y, dir, 7, 1);
        this.dust(def.x / 100, 0, 4, -dir);
        break;
      case 'launch':
        this.spark('launch', x, y, dir, 12, 1);
        this.dustRing(def.x / 100);
        this.startShake(2, 8);
        break;
      case 'wall_splat':
        this.cracks.push({ x, y, side: x < sim.arenaLeft / 100 + 40 ? 1 : -1, t: 0, seed: irnd(0, 9999) });
        for (let i = 0; i < 10; i++) this.add({ x, y: y + rnd(-10, 10), vx: rnd(0.2, 1) * (x < (sim.arenaLeft + sim.arenaRight) / 200 ? 1 : -1), vy: rnd(-0.5, 0.8), g: 0.08, life: irnd(20, 40), color: COL.stoneLight, size: 1, bounce: false });
        this.startShake(3, 10);
        break;
      case 'knockdown':
      case 'land':
        this.splash(x);
        break;
      case 'armor_absorb': {
        const w = Math.round((def.halfWidth * 2) / 100);
        this.spark('ring', def.x / 100, def.y / 100 + def.height / 200, dir, 10, 1, w, Math.round(def.height / 100));
        break;
      }
      case 'dash':
        this.dust(x, 0, 4, 0);
        break;
      case 'wall_break':
        for (let i = 0; i < 16; i++) {
          const size = irnd(2, 6);
          this.add({ x: x + rnd(-6, 6), y: rnd(20, 120), vx: rnd(0.3, 2.2), vy: rnd(0, 1.5), g: 0.15, life: 90, color: i % 3 ? COL.stone : COL.stoneLight, size, bounce: true });
        }
        for (let i = 0; i < 14; i++) this.add({ x: x + rnd(-4, 10), y: rnd(0, 140), vx: rnd(0, 1), vy: rnd(-0.3, 0.3), g: 0.02, life: irnd(30, 60), color: COL.dust, size: 1, bounce: false });
        this.startShake(3, 12);
        break;
      case 'ko':
        this.koFrames = 0;
        break;
      default:
        break;
    }
  }

  private add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private spark(kind: SparkKind, x: number, y: number, dir: number, max: number, scale: number, w?: number, h?: number): void {
    this.sparks.push({ kind, x, y, dir, t: 0, max, scale, w, h });
  }

  private spray(x: number, y: number, dir: number, scale: number): void {
    const n = Math.round(10 * scale);
    for (let i = 0; i < n; i++) {
      const water = i % 2 === 0;
      this.add({ x, y: Math.max(1, y), vx: dir * rnd(0.3, 1.8), vy: rnd(0.8, 2.4), g: 0.18, life: irnd(14, 26), color: water ? COL.water : COL.grit, size: 1, bounce: false });
    }
  }

  private dust(x: number, y: number, n: number, dir: number): void {
    for (let i = 0; i < n; i++) {
      this.add({ x: x + rnd(-3, 3), y: y + 1, vx: (dir || (Math.random() < 0.5 ? -1 : 1)) * rnd(0.2, 0.8), vy: rnd(0.1, 0.5), g: 0.02, life: irnd(12, 22), color: COL.dust, size: 1, bounce: false });
    }
  }

  private dustRing(x: number): void {
    for (let i = 0; i < 8; i++) {
      const d = i < 4 ? -1 : 1;
      this.add({ x, y: 1, vx: d * rnd(0.6, 1.6), vy: rnd(0.1, 0.4), g: 0.02, life: irnd(14, 24), color: COL.dust, size: 1, bounce: false });
    }
  }

  private splash(x: number): void {
    for (let i = 0; i < 10; i++) this.add({ x: x + rnd(-8, 8), y: 1, vx: rnd(-1, 1), vy: rnd(1, 2.6), g: 0.2, life: irnd(14, 24), color: i % 3 ? COL.water : COL.waterDark, size: 1, bounce: false });
    this.dust(x, 0, 4, 0);
  }

  private startShake(amp: number, frames: number): void {
    if (amp >= this.shakeAmp || this.shakeLeft === 0) {
      this.shakeAmp = amp;
      this.shakeLeft = frames;
      this.shakeLen = frames;
    }
  }

  /** Camera offset in whole pixels for this frame (decays over the shake). */
  shake(): [number, number] {
    if (this.shakeLeft <= 0) return [0, 0];
    const a = Math.max(1, Math.round((this.shakeAmp * this.shakeLeft) / this.shakeLen));
    return [irnd(-a, a), irnd(-a, a)];
  }

  isFlashing(i: number): boolean {
    return this.frame < this.flashUntil[i]!;
  }

  /** Record where a fighter's sprite was drawn (world px) for afterimages. */
  noteSprite(i: number, cell: number, x: number, y: number, facing: number): void {
    const t = this.trail[i]!;
    const last = t[t.length - 1];
    if (last && last.x === x && last.y === y && last.cell === cell) return;
    t.push({ cell, x, y, facing });
    if (t.length > 12) t.shift();
  }

  /** Phase step: 3 fading afterimages in tarnished gold. */
  afterimages(i: number): Afterimage[] {
    if (this.ghostsLeft[i]! <= 0) return [];
    const t = this.trail[i]!;
    const out: Afterimage[] = [];
    const fade = Math.min(1, this.ghostsLeft[i]! / 10);
    [9, 6, 3].forEach((back, k) => {
      const g = t[t.length - 1 - back];
      if (g) out.push({ ...g, alpha: [0.2, 0.3, 0.45][k]! * fade, color: COL.gold });
    });
    return out;
  }

  /** Effects that belong behind the fighters (wall cracks). */
  drawBehind(ctx: CanvasRenderingContext2D, cam: Camera, _sim: CombatSim): void {
    for (const c of this.cracks) {
      const sx = Math.round(c.x) - cam.x;
      const sy = FLOOR_Y - Math.round(c.y) + cam.shakeY;
      ctx.fillStyle = COL.crack;
      let s = c.seed;
      const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
      for (let k = 0; k < 6; k++) {
        let px = sx;
        let py = sy;
        const dy = r() < 0.5 ? -1 : 1;
        for (let n = 0; n < 6 + Math.floor(r() * 6); n++) {
          ctx.fillRect(px, py, 1, 1);
          px += c.side * (r() < 0.6 ? 1 : 0);
          py += dy * (r() < 0.7 ? 1 : 0);
        }
      }
    }
  }

  /** Sparks, particles and text, in front of the fighters. */
  drawFront(ctx: CanvasRenderingContext2D, cam: Camera, _sim: CombatSim): void {
    const sx = (x: number) => Math.round(x) - cam.x;
    const sy = (y: number) => FLOOR_Y - Math.round(y) + cam.shakeY;
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(sx(p.x), sy(p.y) - p.size + 1, p.size, p.size);
    }
    for (const s of this.sparks) this.drawSpark(ctx, s, sx(s.x), sy(s.y));
  }

  private drawSpark(ctx: CanvasRenderingContext2D, s: Spark, x: number, y: number): void {
    const k = s.t / s.max;
    switch (s.kind) {
      case 'streak': {
        const len = Math.round((6 + 14 * k) * s.scale);
        ctx.fillStyle = COL.white;
        ctx.fillRect(s.dir === 1 ? x - 2 : x - len + 2, y, len, s.scale > 1 ? 2 : 1);
        if (s.t < 4) {
          ctx.fillRect(x, y - 2, 1, 5);
          ctx.fillRect(x - 1, y - 1, 3, 3);
        }
        break;
      }
      case 'burst': {
        const r = Math.round((2 + 7 * k) * s.scale);
        ctx.fillStyle = s.t < 3 ? COL.white : COL.paleGold;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          const d = dx && dy ? Math.round(r * 0.7) : r;
          ctx.fillRect(x + dx * d, y + dy * d, 2, 2);
          ctx.fillRect(x + dx * (d >> 1), y + dy * (d >> 1), 1, 1);
        }
        if (s.t < 3) ctx.fillRect(x - 1, y - 1, 3, 3);
        break;
      }
      case 'block': {
        const r = 1 + Math.round(3 * k);
        ctx.fillStyle = COL.blockBlue;
        ctx.fillRect(x - r, y, r * 2 + 1, 1);
        ctx.fillRect(x, y - r, 1, r * 2 + 1);
        break;
      }
      case 'launch': {
        const h = Math.round(10 + 30 * k);
        ctx.fillStyle = COL.white;
        ctx.fillRect(x, y - h, 1, h);
        ctx.fillRect(x - 1, y - h, 3, 2);
        break;
      }
      case 'ring': {
        const g = Math.round(2 + 6 * k);
        ctx.strokeStyle = COL.metal;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1 - k * 0.7;
        const w = (s.w ?? 20) + g * 2;
        const h = (s.h ?? 40) + g * 2;
        ctx.strokeRect(x - (w >> 1) + 0.5, y - (h >> 1) + 0.5, w, h);
        ctx.globalAlpha = 1;
        break;
      }
      case 'text':
        drawPixelText(ctx, 'COUNTER', x, y - Math.min(4, s.t >> 2), s.t < 24 || s.t % 4 < 2 ? COL.counter : null);
        break;
    }
  }
}

/** A tiny 3x5 pixel font (only the letters the effects use). */
const GLYPHS: Record<string, string[]> = {
  C: ['111', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'],
  U: ['101', '101', '101', '101', '111'],
  N: ['101', '111', '111', '111', '101'],
  T: ['111', '010', '010', '010', '010'],
  E: ['111', '100', '110', '100', '111'],
  R: ['110', '101', '110', '101', '101'],
};

export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color: string | null): void {
  if (!color) return;
  const w = text.length * 4 - 1;
  let x = Math.round(cx - w / 2);
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      // Dark outline then the letter.
      for (const [c, ox, oy] of [['#000', 1, 1], [color, 0, 0]] as const) {
        ctx.fillStyle = c;
        g.forEach((row, ry) => {
          for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') ctx.fillRect(x + rx + ox, y + ry + oy, 1, 1);
        });
      }
    }
    x += 4;
  }
}
