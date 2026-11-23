/**
 * Placeholder renderer: arena, fighters as coloured rectangles, health/stamina/poise bars.
 * Views never change game state: everything here only reads the sim.
 */
import type { CombatSim } from '../combat/combat_sim';
import type { Fighter, WorldBox } from '../combat/fighter';
import { SYSTEM } from '../combat/system';
import { Camera, FLOOR_Y } from './camera';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

export interface FighterLook {
  body: string;
  limb: string;
}

export const LOOKS: readonly FighterLook[] = [
  { body: '#a8873a', limb: '#d8b867' }, // Rook: tarnished gold
  { body: '#77777f', limb: '#a5a5ad' }, // Dummy: grey
];

export const OUTLINE = {
  attack: '#ffffff',
  hitstun: '#ff3b3b',
  blockstun: '#3b8bff',
  invuln: '#b45cff',
} as const;

export class Renderer {
  readonly camera = new Camera();

  draw(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    this.camera.follow(sim);
    ctx.fillStyle = '#15131c';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.drawArena(ctx, sim);
    // Draw the dummy first so the player is on top.
    for (const f of [sim.fighters[1], sim.fighters[0]]) this.drawFighter(ctx, f);
    this.drawBars(ctx, sim);
  }

  private drawArena(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const c = this.camera;
    // Distance markers every 60 px help read spacing.
    ctx.fillStyle = '#211e2b';
    for (let x = sim.arenaLeft / 100; x <= sim.arenaRight / 100; x += 60) ctx.fillRect(x - c.x, FLOOR_Y + 1, 1, 4);
    ctx.fillStyle = '#1b1824';
    ctx.fillRect(0, FLOOR_Y + 1, BASE_WIDTH, BASE_HEIGHT - FLOOR_Y - 1);
    ctx.fillStyle = '#5a5468';
    ctx.fillRect(0, FLOOR_Y, BASE_WIDTH, 1);
    // Walls.
    ctx.fillStyle = '#3a3546';
    const left = c.sx(sim.arenaLeft);
    const right = c.sx(sim.arenaRight);
    if (left >= 0) ctx.fillRect(left - 4, 0, 4, FLOOR_Y + 1);
    if (right <= BASE_WIDTH) ctx.fillRect(right, 0, 4, FLOOR_Y + 1);
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

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const look = LOOKS[f.index]!;
    let body: WorldBox = f.hurtbox();
    if (f.state === 'knockdown') {
      // Lying flat.
      body = { x0: f.x - 3000, x1: f.x + 3000, y0: 0, y1: 1200 };
    } else if (f.state === 'wake_up') {
      body = { x0: f.x - f.halfWidth, x1: f.x + f.halfWidth, y0: 0, y1: Math.trunc(f.height / 2) };
    }
    const [x, y, w, h] = this.rect(body);
    ctx.fillStyle = look.body;
    ctx.fillRect(x, y, w, h);

    // Facing marker ("eye") near the top, on the facing side.
    if (f.state !== 'knockdown') {
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

    // Attack glint during startup: white = linear, red = sweeping.
    if (f.state === 'attack' && f.move && f.move.height !== 'throw') {
      const toActive = f.move.startup - f.moveFrame;
      if (toActive >= 1 && toActive <= 6) {
        ctx.fillStyle = f.move.path === 'sweeping' ? '#ff3b3b' : '#ffffff';
        const gx = f.facing === 1 ? x + w + 1 : x - 4;
        ctx.fillRect(gx, y + 2, 3, 3);
        if (toActive <= 3) ctx.fillRect(gx - 1, y + 3, 5, 1);
      }
    }

    // State outline.
    let outline: string | null = null;
    if (f.isPhaseInvulnerable) outline = OUTLINE.invuln;
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

  private drawBars(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const W = 196;
    const H = 6;
    const top = 10;
    for (const f of sim.fighters) {
      const left = f.index === 0 ? 12 : BASE_WIDTH - 12 - W;
      const look = LOOKS[f.index]!;
      bar(ctx, left, top, W, H, f.health / f.maxHealth, look.limb, f.index === 1);
      bar(ctx, left, top + H + 2, W, 2, f.stamina / SYSTEM.staminaMax, '#4fb3a9', f.index === 1);
      bar(ctx, left, top + H + 5, W, 2, f.poise / f.maxPoise, '#9a7fd1', f.index === 1);
    }
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, fromRight: boolean): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#2a2633';
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.max(0, Math.min(1, frac)));
  ctx.fillStyle = color;
  ctx.fillRect(fromRight ? x + w - fw : x, y, fw, h);
}
