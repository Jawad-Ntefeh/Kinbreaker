/** Camera: follows the midpoint between the fighters with a slight lag, clamped to the arena. View-only. */
import type { CombatSim } from '../combat/combat_sim';
import { BASE_WIDTH } from './screen';

export const FLOOR_Y = 317;
/** Fraction of the distance to the target covered per frame (view-only smoothing). */
const LAG = 0.2;
/** The camera may show this many px beyond each wall, so the walls themselves are visible. */
export const WALL_MARGIN = 16;

export class Camera {
  /** Left edge of the view in arena pixels (whole pixels, shake included). */
  x = 0;
  private fx: number | null = null;
  shakeX = 0;
  shakeY = 0;

  follow(sim: CombatSim): void {
    const [a, b] = sim.fighters;
    const mid = (a.x + b.x) / 2 / 100;
    const left = sim.arenaLeft / 100 - WALL_MARGIN;
    const right = sim.arenaRight / 100 + WALL_MARGIN;
    const target = Math.min(right - BASE_WIDTH, Math.max(left, mid - BASE_WIDTH / 2));
    this.fx = this.fx === null ? target : this.fx + (target - this.fx) * LAG;
    this.fx = Math.min(right - BASE_WIDTH, Math.max(left, this.fx));
    this.x = Math.round(this.fx) + this.shakeX;
  }

  /** Jump straight to the target (scene start). */
  snap(): void {
    this.fx = null;
  }

  /** Sim subpixel x → screen pixel x. */
  sx(simX: number): number {
    return Math.round(simX / 100) - this.x;
  }

  /** Sim subpixel height → screen pixel y. */
  sy(simY: number): number {
    return FLOOR_Y - Math.round(simY / 100) + this.shakeY;
  }
}
