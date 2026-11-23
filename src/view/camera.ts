/** Camera: follows the midpoint between the fighters, clamped to the arena. View-only. */
import type { CombatSim } from '../combat/combat_sim';
import { BASE_WIDTH } from './screen';

export const FLOOR_Y = 238;

export class Camera {
  /** Left edge of the view in arena pixels. */
  x = 0;

  follow(sim: CombatSim): void {
    const [a, b] = sim.fighters;
    const mid = (a.x + b.x) / 2 / 100;
    const left = sim.arenaLeft / 100;
    const right = sim.arenaRight / 100;
    this.x = Math.round(Math.min(right - BASE_WIDTH, Math.max(left, mid - BASE_WIDTH / 2)));
  }

  /** Sim subpixel x → screen pixel x. */
  sx(simX: number): number {
    return Math.round(simX / 100) - this.x;
  }

  /** Sim subpixel height → screen pixel y. */
  sy(simY: number): number {
    return FLOOR_Y - Math.round(simY / 100);
  }
}
