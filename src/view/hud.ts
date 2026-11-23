/** HUDs: health/stamina/poise bars. Read-only views of the sim. */
import type { CombatSim } from '../combat/combat_sim';
import { SYSTEM } from '../combat/system';
import { FONT, text } from './text';
import { lookOf } from './renderer';
import { BASE_WIDTH } from './screen';

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, fromRight = false): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#2a2633';
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.max(0, Math.min(1, frac)));
  ctx.fillStyle = color;
  ctx.fillRect(fromRight ? x + w - fw : x, y, fw, h);
}

/** Training: two bars at the top, names above. */
export function drawVersusHud(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
  const W = 261;
  for (const f of sim.fighters) {
    const left = f.index === 0 ? 16 : BASE_WIDTH - 16 - W;
    const r = f.index === 1;
    bar(ctx, left, 13, W, 8, f.health / f.maxHealth, lookOf(f).limb, r);
    bar(ctx, left, 24, W, 3, f.stamina / SYSTEM.staminaMax, '#4fb3a9', r);
    bar(ctx, left, 28, W, 3, f.poise / f.maxPoise, '#9a7fd1', r);
  }
}

export function drawVersusHudText(o: CanvasRenderingContext2D, sim: CombatSim): void {
  o.font = FONT;
  const [a, b] = sim.fighters;
  text(o, a.name.toUpperCase(), 16, 2, '#d8b867');
  text(o, b.name.toUpperCase(), BASE_WIDTH - 16, 2, '#c8c8d0', 'right');
}

export const BOSS_BAR = { x: 80, y: 328, w: 480 } as const;

/**
 * Souls-style boss HUD: Rook's health (gold) and stamina (pale) top left; the boss's name,
 * long health bar and thin poise bar at the bottom centre.
 */
export class BossHud {
  /** Damage number shown above the boss bar (combo total), and frames left to show it. */
  private shownDamage = 0;
  private shownFor = 0;
  private lastCombo = 0;

  /** Call once per sim step (view-side bookkeeping only). */
  observe(sim: CombatSim): void {
    const boss = sim.fighters[1];
    if (boss.comboDamage !== this.lastCombo && boss.comboDamage > 0) {
      this.shownDamage = boss.comboDamage;
      this.shownFor = 90;
    }
    this.lastCombo = boss.comboDamage;
    if (this.shownFor > 0) this.shownFor--;
  }

  draw(ctx: CanvasRenderingContext2D, sim: CombatSim): void {
    const [rook, boss] = sim.fighters;
    bar(ctx, 16, 16, 200, 7, rook.health / rook.maxHealth, '#d8b867');
    bar(ctx, 16, 27, Math.round(200 * 0.66), 3, rook.stamina / SYSTEM.staminaMax, '#d9d4c3');
    const { x, y, w } = BOSS_BAR;
    bar(ctx, x, y, w, 5, boss.health / boss.maxHealth, '#8f8a7a');
    bar(ctx, x, y + 8, w, 1, boss.poise / boss.maxPoise, '#9a7fd1');
  }

  drawText(o: CanvasRenderingContext2D, sim: CombatSim): void {
    const boss = sim.fighters[1];
    o.font = FONT;
    text(o, boss.name, BOSS_BAR.x, BOSS_BAR.y - 12, '#d9d4c3');
    if (this.shownFor > 0) text(o, String(this.shownDamage), BOSS_BAR.x + BOSS_BAR.w, BOSS_BAR.y - 12, '#ffffff', 'right');
  }
}
