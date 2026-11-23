/**
 * Debug overlay: hit/hurt/push boxes and throw ranges (pixel layer), plus fighter state,
 * frame data, measured frame advantage, combo counter and input history (text layer).
 * Read-only: never changes game state.
 */
import type { CombatSim } from '../combat/combat_sim';
import type { Fighter, WorldBox } from '../combat/fighter';
import type { Renderer } from './renderer';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

const BOX = {
  hurt: '#3b8bff',
  hit: '#ff3b3b',
  throw: '#ffd23b',
  push: '#3bff7a',
} as const;

export interface OverlayInfo {
  simFps: number;
  dummyMode: string;
  /** Pause label to show, or null when running. */
  paused: string | null;
  controls: string;
}

export const FONT = '6px ui-monospace, Menlo, Consolas, monospace';

export class DebugOverlay {
  visible = true;

  /** Boxes, drawn into the pixel buffer. */
  drawBoxes(ctx: CanvasRenderingContext2D, sim: CombatSim, r: Renderer): void {
    if (!this.visible) return;
    for (const f of sim.fighters) {
      this.box(ctx, r, f.pushbox(), BOX.push, 0.04);
      if (f.isHittable) this.box(ctx, r, f.hurtbox(), BOX.hurt, 0.08);
      for (const { box } of f.activeHitboxes()) this.box(ctx, r, box, BOX.hit, 0.45);
      const tz = f.throwZone();
      if (tz) this.box(ctx, r, tz, BOX.throw, 0.35);
    }
  }

  private box(ctx: CanvasRenderingContext2D, r: Renderer, b: WorldBox, color: string, alpha: number): void {
    const [x, y, w, h] = r.rect(b);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = Math.min(1, alpha + 0.4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.globalAlpha = 1;
  }

  /** Text, drawn on the display canvas in base-resolution coordinates (crisp at any scale). */
  drawText(ctx: CanvasRenderingContext2D, sim: CombatSim, info: OverlayInfo): void {
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    const [p1, p2] = sim.fighters;
    // Names on the health bars are always shown.
    text(ctx, p1.name.toUpperCase(), 12, 1, '#d8b867');
    text(ctx, p2.name.toUpperCase(), BASE_WIDTH - 12, 1, '#c8c8d0', 'right');

    if (info.paused) text(ctx, info.paused, BASE_WIDTH / 2, 50, '#fff', 'center');

    if (!this.visible) {
      text(ctx, '` debug overlay', BASE_WIDTH - 4, BASE_HEIGHT - 9, '#777', 'right');
      return;
    }

    this.fighterBlock(ctx, p1, 12, 30, 'left');
    this.fighterBlock(ctx, p2, BASE_WIDTH - 12, 30, 'right');

    // Frame advantage (measured by the sim).
    const adv = sim.lastAdvantage;
    if (adv) {
      const v = adv.value;
      const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
      const color = v > 0 ? '#7dff9a' : v < 0 ? '#ff8a8a' : '#ffffff';
      text(ctx, `${adv.kind}  ${adv.moveId}  ${sign}${Math.abs(v)}`, BASE_WIDTH / 2, 30, color, 'center');
    }
    // Combo counter.
    const d = p2;
    if (d.comboHits > 0) {
      text(ctx, `${d.comboHits} HIT${d.comboHits > 1 ? 'S' : ''}  ${d.comboDamage} DMG`, BASE_WIDTH / 2, 38, d.comboActive ? '#ffe08a' : '#9a9080', 'center');
    }

    // Input history, newest at the top.
    text(ctx, 'INPUT', 12, 62, '#888');
    p1.buffer.historyEntries(12, p1.facing).forEach((e, i) => {
      text(ctx, e, 12, 70 + i * 7, i === 0 ? '#fff' : '#aaa');
    });

    text(ctx, `sim ${info.simFps} fps  frame ${sim.frame}`, BASE_WIDTH - 4, 252, '#888', 'right');
    text(ctx, `dummy: ${info.dummyMode}  (T)`, 4, 252, '#888');
    text(ctx, info.controls, BASE_WIDTH / 2, BASE_HEIGHT - 9, '#9a9aa8', 'center');
  }

  private fighterBlock(ctx: CanvasRenderingContext2D, f: Fighter, x: number, y: number, align: CanvasTextAlign): void {
    const moveLine = f.move ? `${f.move.id} ${f.moveFrame}/${f.move.total}` : timed(f);
    text(ctx, `${f.state}${f.hitstop ? `  (hitstop ${f.hitstop})` : ''}`, x, y, '#fff', align);
    text(ctx, moveLine, x, y + 7, '#ccc', align);
    text(ctx, `HP ${f.health}/${f.maxHealth}  POISE ${f.poise}  STAM ${f.stamina}`, x, y + 14, '#aaa', align);
  }
}

function timed(f: Fighter): string {
  if (f.stateLength > 0) return `${f.stateFrame}/${f.stateLength}`;
  return '';
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.textAlign = align;
  ctx.fillStyle = '#000';
  ctx.fillText(s, x + 0.35, y + 0.35);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
