/**
 * Placeholder renderer: arena, fighters as coloured rectangles, glints.
 * Views never change game state: everything here only reads the sim.
 */
import type { CombatSim } from '../combat/combat_sim';
import type { Fighter, WorldBox } from '../combat/fighter';
import { pickFrame, type ScenePose } from './anim_select';
import { Backgrounds } from './background';
import { Camera, FLOOR_Y } from './camera';
import type { Effects } from './effects';
import { silhouette, SpriteBank, type CharacterSprites } from './sprites';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

export interface FighterLook {
  body: string;
  limb: string;
}

/** Colours per character. Red is never a character accent (it means "sweeping"). */
export const LOOKS: Readonly<Record<string, FighterLook>> = {
  rook: { body: '#a8873a', limb: '#d8b867' }, // tarnished gold
  dummy: { body: '#77777f', limb: '#a5a5ad' },
  corvane: { body: '#5f666e', limb: '#9aa1a8' }, // iron grey (rust-brown leather is secondary)
};
const DEFAULT_LOOK: FighterLook = { body: '#777', limb: '#aaa' };

export const OUTLINE = {
  attack: '#ffffff',
  hitstun: '#ff3b3b',
  blockstun: '#3b8bff',
  invuln: '#b45cff',
  armor: '#ffd23b',
} as const;

export const GLINT = { white: '#ffffff', red: '#ff3b3b' } as const;

export function lookOf(f: Fighter): FighterLook {
  return LOOKS[f.config.id ?? ''] ?? DEFAULT_LOOK;
}

/** What was drawn for a fighter (debug overlay). */
export interface SpriteInfo {
  anim: string;
  cell: number;
  label: string;
  /** Pivot on screen. */
  x: number;
  y: number;
  cellW: number;
  cellH: number;
  pivot: readonly [number, number];
  facing: number;
}

export type SpriteMode = 'normal' | 'faded' | 'hidden';

export class Renderer {
  readonly camera = new Camera();
  readonly bank = new SpriteBank();
  readonly backgrounds = new Backgrounds();
  /** Frame counter for simple animation (view-only). */
  private tick = 0;
  spriteMode: SpriteMode = 'normal';
  /** Scene poses (boss intro, victory) per fighter. */
  pose: ScenePose[] = [null, null];
  /** Clock for scene poses (intro, victory), set by the scene: the sim is frozen while they play. */
  poseTime = 0;
  /** 0..1: fade of everything except the fighters (KO). */
  koFade = 0;
  readonly lastDrawn: (SpriteInfo | null)[] = [null, null];
  private readonly tracks = [{ anim: '', start: 0 }, { anim: '', start: 0 }];
  private onTop = 0;
  private readonly lastMove = ['', ''];

  draw(ctx: CanvasRenderingContext2D, sim: CombatSim, fx: Effects | null = null): void {
    this.tick++;
    const shake = fx?.shake() ?? [0, 0];
    this.camera.shakeX = shake[0];
    this.camera.shakeY = shake[1];
    this.camera.follow(sim);
    if (!this.backgrounds.draw(ctx, sim.arena, sim, this.camera)) this.drawTrainingGround(ctx, sim);
    else this.drawWalls(ctx, sim, '#2c2934', !!sim.arena.leftWall);
    fx?.drawBehind(ctx, this.camera, sim);
    for (const f of sim.fighters) this.drawShadow(ctx, f);
    // KO: everything but the fighters fades out.
    if (this.koFade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${(this.koFade * 0.75).toFixed(2)})`;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    }
    // The fighter who attacked most recently is drawn on top.
    for (const f of sim.fighters) {
      if (f.state === 'attack' && f.move && (f.moveFrame === 1 || this.lastMove[f.index] !== f.move.id)) this.onTop = f.index;
      this.lastMove[f.index] = f.move?.id ?? '';
    }
    const order = this.onTop === 0 ? [sim.fighters[1], sim.fighters[0]] : [sim.fighters[0], sim.fighters[1]];
    for (const f of order) this.drawFighter(ctx, sim, f, fx);
    for (const f of sim.fighters) this.drawGlint(ctx, f);
    fx?.drawFront(ctx, this.camera, sim);
  }

  /** Debug: H cycles normal → 50% transparent → hidden (boxes only). */
  cycleSpriteMode(): void {
    this.spriteMode = this.spriteMode === 'normal' ? 'faded' : this.spriteMode === 'faded' ? 'hidden' : 'normal';
  }

  private drawTrainingGround(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const c = this.camera;
    ctx.fillStyle = '#15131c';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    ctx.fillStyle = '#1b1824';
    ctx.fillRect(0, FLOOR_Y + 1, BASE_WIDTH, BASE_HEIGHT - FLOOR_Y - 1);
    ctx.fillStyle = '#211e2b';
    for (let x = sim.arenaLeft / 100; x <= sim.arenaRight / 100; x += 80) ctx.fillRect(x - c.x, FLOOR_Y + 1, 1, 5);
    ctx.fillStyle = '#5a5468';
    ctx.fillRect(0, FLOOR_Y, BASE_WIDTH, 1);
    this.drawWalls(ctx, sim, '#3a3546');
  }

  private drawWalls(ctx: CanvasRenderingContext2D, sim: CombatSim, color: string, leftHasArt = false): void {
    const c = this.camera;
    ctx.fillStyle = color;
    const left = c.sx(sim.arenaLeft);
    const right = c.sx(sim.arenaRight);
    if (left >= 0 && !(leftHasArt && !sim.wallBroken)) ctx.fillRect(left - 16, 0, 16, FLOOR_Y + 1);
    if (right <= BASE_WIDTH) ctx.fillRect(right, 0, 16, FLOOR_Y + 1);
  }

  /** Screen rect for a world box. */
  rect(b: WorldBox): [number, number, number, number] {
    const c = this.camera;
    const x0 = c.sx(b.x0);
    const x1 = c.sx(b.x1);
    const y0 = c.sy(b.y1);
    const y1 = c.sy(b.y0);
    return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
  }

  /** Small dark ellipse under a fighter, shrinking with height. */
  private drawShadow(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const x = this.camera.sx(f.x);
    const h = Math.round(f.y / 100);
    const half = Math.max(5, Math.round((f.halfWidth / 100) * 1.4) - Math.min(11, Math.trunc(h / 8)));
    ctx.fillStyle = '#0b0a0f';
    ctx.fillRect(x - half + 3, FLOOR_Y, half * 2 - 5, 2);
    ctx.fillRect(x - half, FLOOR_Y + 1, half * 2 + 1, 2);
  }

  /** Pick and draw a fighter's sprite; records what was drawn for the debug overlay. */
  private drawFighter(ctx: CanvasRenderingContext2D, sim: CombatSim, f: Fighter, fx: Effects | null): void {
    const sprites = this.bank.get(f.config.id ?? 'rook');
    const file = sprites.file;
    const track = this.tracks[f.index]!;
    const pose = this.pose[f.index] ?? null;
    const picked = pickFrame(f, file, pose, track, pose ? this.poseTime : sim.frame);
    const info: SpriteInfo = { anim: '', cell: -1, label: '', x: 0, y: 0, cellW: file.cell[0], cellH: file.cell[1], pivot: file.pivot, facing: f.facing };
    this.lastDrawn[f.index] = info;
    if (!picked) return;
    const { choice, anim, index: idx } = picked;
    const frame = anim.frames[idx]!;
    // Whole pixels: round the sim position once.
    const sx = this.camera.sx(f.x);
    const sy = this.camera.sy(f.y);
    info.anim = choice.name;
    info.cell = frame.cell;
    info.x = sx;
    info.y = sy;
    info.label =
      choice.kind === 'move' && f.move
        ? `${choice.name}  cell ${frame.cell}  f${f.moveFrame}/${f.moveTotal}${frame.impact && f.moveFrame >= f.move.startup && f.moveFrame <= f.move.lastActive ? '  IMPACT' : ''}`
        : `${choice.name}  cell ${frame.cell}`;
    if (this.spriteMode === 'hidden') return;

    for (const ghost of fx?.afterimages(f.index) ?? []) {
      this.blit(ctx, sprites, silhouette(sprites, ghost.color), ghost.cell, ghost.x - this.camera.x, FLOOR_Y - ghost.y + this.camera.shakeY, ghost.facing, ghost.alpha * this.spriteAlpha());
    }
    const flash = fx?.isFlashing(f.index) ?? false;
    const src = flash ? silhouette(sprites, '#ffffff') : sprites.sheet;
    this.blit(ctx, sprites, src, frame.cell, sx, sy, f.facing, this.spriteAlpha());
    fx?.noteSprite(f.index, frame.cell, Math.round(f.x / 100), Math.round(f.y / 100), f.facing);
  }

  private spriteAlpha(): number {
    return this.spriteMode === 'faded' ? 0.5 : 1;
  }

  /** Draw one cell with its pivot at (sx, sy), mirrored around the pivot when facing left. */
  private blit(
    ctx: CanvasRenderingContext2D,
    s: CharacterSprites,
    src: CanvasImageSource,
    cell: number,
    sx: number,
    sy: number,
    facing: number,
    alpha: number,
  ): void {
    const [cw, ch] = s.file.cell;
    const [px, py] = s.file.pivot;
    const cx = (cell % s.columns) * cw;
    const cy = Math.floor(cell / s.columns) * ch;
    ctx.globalAlpha = alpha;
    if (facing === 1) {
      ctx.drawImage(src, cx, cy, cw, ch, sx - px, sy - py, cw, ch);
    } else {
      ctx.save();
      ctx.translate(sx + 1, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, cx, cy, cw, ch, -px, sy - py, cw, ch);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Glint: a star-shaped flash at the attacker's hand (white = linear, red = sweeping). */
  private drawGlint(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const g = f.glint;
    if (!g) return;
    const [x, y, w] = this.rect(f.hurtbox());
    const hx = f.facing === 1 ? x + w + 4 : x - 5;
    const hy = y + Math.round((f.height / 100) * 0.3);
    // Pulse: the star grows over the glint window.
    const m = f.move!;
    const t = f.moveFrame - (m.startup - 14);
    const r = t < 2 ? 3 : t < 6 ? 5 : 8;
    ctx.fillStyle = GLINT[g];
    ctx.fillRect(hx - r, hy, r * 2 + 1, 1);
    ctx.fillRect(hx, hy - r, 1, r * 2 + 1);
    const d = Math.max(1, r >> 1);
    for (let i = 1; i <= d; i++) {
      ctx.fillRect(hx - i, hy - i, 1, 1);
      ctx.fillRect(hx + i, hy - i, 1, 1);
      ctx.fillRect(hx - i, hy + i, 1, 1);
      ctx.fillRect(hx + i, hy + i, 1, 1);
    }
    ctx.fillRect(hx - 1, hy - 1, 3, 3);
  }
}
