/**
 * Placeholder renderer: arena, fighters as coloured rectangles, glints.
 * Views never change game state: everything here only reads the sim.
 */
import type { CombatSim } from '../combat/combat_sim';
import type { Fighter, WorldBox } from '../combat/fighter';
import { Camera, FLOOR_Y } from './camera';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

export interface FighterLook {
  body: string;
  limb: string;
}

/** Colours per character. Red is never a character accent (it means "sweeping"). */
export const LOOKS: Readonly<Record<string, FighterLook>> = {
  rook: { body: '#a8873a', limb: '#d8b867' }, // tarnished gold
  dummy: { body: '#77777f', limb: '#a5a5ad' },
  corvane: { body: '#4d5966', limb: '#8fa3b5' }, // iron
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

export class Renderer {
  readonly camera = new Camera();
  /** Frame counter for simple animation (view-only). */
  private tick = 0;

  draw(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    this.tick++;
    this.camera.follow(sim);
    if (sim.arena.id === 'sunken_colosseum') this.drawColosseum(ctx, sim);
    else this.drawTrainingGround(ctx, sim);
    // Draw the opponent first so the player is on top.
    for (const f of [sim.fighters[1], sim.fighters[0]]) this.drawFighter(ctx, f);
    for (const f of sim.fighters) this.drawGlint(ctx, f);
  }

  private drawTrainingGround(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const c = this.camera;
    ctx.fillStyle = '#15131c';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    ctx.fillStyle = '#1b1824';
    ctx.fillRect(0, FLOOR_Y + 1, BASE_WIDTH, BASE_HEIGHT - FLOOR_Y - 1);
    ctx.fillStyle = '#211e2b';
    for (let x = sim.arenaLeft / 100; x <= sim.arenaRight / 100; x += 60) ctx.fillRect(x - c.x, FLOOR_Y + 1, 1, 4);
    ctx.fillStyle = '#5a5468';
    ctx.fillRect(0, FLOOR_Y, BASE_WIDTH, 1);
    this.drawWalls(ctx, sim, '#3a3546');
  }

  private drawColosseum(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const c = this.camera;
    // Dark stone: back wall in courses of blocks, slower parallax.
    ctx.fillStyle = '#16141b';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    const px = Math.round(c.x * 0.6);
    ctx.fillStyle = '#1c1a22';
    for (let row = 0; row < 12; row++) {
      const y = 40 + row * 16;
      const off = row % 2 ? 0 : 24;
      for (let x = -((px + off) % 48) - 48; x < BASE_WIDTH; x += 48) ctx.fillRect(x, y, 46, 14);
    }
    // Broken columns (darker), at fixed arena positions.
    ctx.fillStyle = '#0f0e13';
    const cols: [number, number][] = [[-160, 120], [80, 150], [330, 90], [610, 160], [880, 110], [1110, 140]];
    for (const [x, h] of cols) {
      const sx = x - c.x;
      if (sx < -40 || sx > BASE_WIDTH + 40) continue;
      ctx.fillRect(sx, FLOOR_Y - h, 26, h);
      ctx.fillRect(sx - 4, FLOOR_Y - h, 34, 6);
      ctx.fillRect(sx + 18, FLOOR_Y - h - 8, 8, 8); // jagged break
    }
    // Floor and a shallow water line.
    ctx.fillStyle = '#1d1b24';
    ctx.fillRect(0, FLOOR_Y + 1, BASE_WIDTH, BASE_HEIGHT - FLOOR_Y - 1);
    ctx.fillStyle = '#4a4656';
    ctx.fillRect(0, FLOOR_Y, BASE_WIDTH, 1);
    ctx.fillStyle = '#1f3240';
    ctx.fillRect(0, FLOOR_Y + 2, BASE_WIDTH, 3);
    ctx.fillStyle = '#3d6077';
    for (let x = -((c.x + (this.tick >> 3)) % 32); x < BASE_WIDTH; x += 32) ctx.fillRect(x, FLOOR_Y + 2, 10, 1);
    this.drawWalls(ctx, sim, '#2c2934');
    // Rubble where the old left wall stood.
    if (sim.wallBroken) {
      const rx = -c.x;
      ctx.fillStyle = '#2c2934';
      ctx.fillRect(rx - 10, FLOOR_Y - 6, 8, 6);
      ctx.fillRect(rx + 2, FLOOR_Y - 4, 6, 4);
      ctx.fillRect(rx - 4, FLOOR_Y - 10, 5, 4);
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D, sim: CombatSim, color: string): void {
    const c = this.camera;
    ctx.fillStyle = color;
    const left = c.sx(sim.arenaLeft);
    const right = c.sx(sim.arenaRight);
    if (left >= 0) ctx.fillRect(left - 6, 0, 6, FLOOR_Y + 1);
    if (right <= BASE_WIDTH) ctx.fillRect(right, 0, 6, FLOOR_Y + 1);
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

  /** The body rectangle drawn for a fighter. */
  bodyBox(f: Fighter): WorldBox {
    if (f.state === 'knockdown' || f.state === 'defeated') {
      const half = Math.trunc(f.height / 2);
      return { x0: f.x - half, x1: f.x + half, y0: 0, y1: Math.trunc(f.height * 0.15) };
    }
    if (f.state === 'wake_up') return { x0: f.x - f.halfWidth, x1: f.x + f.halfWidth, y0: 0, y1: Math.trunc(f.height / 2) };
    return f.hurtbox();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const look = lookOf(f);
    const [x, y, w, h] = this.rect(this.bodyBox(f));
    ctx.fillStyle = look.body;
    ctx.fillRect(x, y, w, h);

    // Facing marker ("eye") near the top, on the facing side.
    if (f.state !== 'knockdown' && f.state !== 'defeated') {
      ctx.fillStyle = '#15131c';
      const ex = f.facing === 1 ? x + w - 6 : x + 3;
      ctx.fillRect(ex, y + 6, 3, 2);
    }

    // Active limbs: draw the hitboxes as limbs so attacks read without the debug view.
    ctx.fillStyle = look.limb;
    for (const { box } of f.activeHitboxes()) {
      const [lx, ly, lw, lh] = this.rect(box);
      ctx.fillRect(lx, ly, lw, lh);
    }

    // State outline.
    let outline: string | null = null;
    if (f.isPhaseInvulnerable) outline = OUTLINE.invuln;
    else if (f.state === 'phase_transition') outline = this.tick % 8 < 4 ? '#ffffff' : null;
    else if (f.isArmored) outline = OUTLINE.armor;
    else if (f.state === 'attack' || f.state === 'throw_attempt') outline = OUTLINE.attack;
    else if (f.state === 'hitstun' || f.state === 'airborne' || f.state === 'wall_splat' || f.state === 'stagger' || f.state === 'thrown')
      outline = OUTLINE.hitstun;
    else if (f.state === 'blockstun' || f.state === 'guard_break') outline = OUTLINE.blockstun;
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  /** Glint: a star-shaped flash at the attacker's hand (white = linear, red = sweeping). */
  private drawGlint(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const g = f.glint;
    if (!g) return;
    const [x, y, w] = this.rect(f.hurtbox());
    const hx = f.facing === 1 ? x + w + 3 : x - 4;
    const hy = y + Math.round((f.height / 100) * 0.3);
    // Pulse: the star grows over the glint window.
    const m = f.move!;
    const t = f.moveFrame - (m.startup - 14);
    const r = t < 2 ? 2 : t < 6 ? 4 : 6;
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
