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
  const W = 196;
  for (const f of sim.fighters) {
    const left = f.index === 0 ? 12 : BASE_WIDTH - 12 - W;
    const r = f.index === 1;
    bar(ctx, left, 10, W, 6, f.health / f.maxHealth, lookOf(f).limb, r);
    bar(ctx, left, 18, W, 2, f.stamina / SYSTEM.staminaMax, '#4fb3a9', r);
    bar(ctx, left, 21, W, 2, f.poise / f.maxPoise, '#9a7fd1', r);
  }
}

export function drawVersusHudText(o: CanvasRenderingContext2D, sim: CombatSim): void {
  o.font = FONT;
  const [a, b] = sim.fighters;
  text(o, a.name.toUpperCase(), 12, 1, '#d8b867');
  text(o, b.name.toUpperCase(), BASE_WIDTH - 12, 1, '#c8c8d0', 'right');
}

export const BOSS_BAR = { x: 60, y: 246, w: 360 } as const;

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
    bar(ctx, 12, 12, 150, 5, rook.health / rook.maxHealth, '#d8b867');
    bar(ctx, 12, 20, Math.round(150 * 0.66), 2, rook.stamina / SYSTEM.staminaMax, '#d9d4c3');
    const { x, y, w } = BOSS_BAR;
    bar(ctx, x, y, w, 4, boss.health / boss.maxHealth, '#8f8a7a');
    bar(ctx, x, y + 6, w, 1, boss.poise / boss.maxPoise, '#9a7fd1');
  }

  drawText(o: CanvasRenderingContext2D, sim: CombatSim): void {
    const boss = sim.fighters[1];
    o.font = FONT;
    text(o, boss.name, BOSS_BAR.x, BOSS_BAR.y - 9, '#d9d4c3');
    if (this.shownFor > 0) text(o, String(this.shownDamage), BOSS_BAR.x + BOSS_BAR.w, BOSS_BAR.y - 9, '#ffffff', 'right');
  }
}
