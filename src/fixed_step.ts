/** Fixed-timestep accumulator: 60 Hz sim steps regardless of display refresh rate. */
export const STEP_MS = 1000 / 60;
/** If more than this many steps are pending, the backlog is dropped. */
export const MAX_PENDING_STEPS = 3;

export class FixedStep {
  private acc = 0;
  private last: number | null = null;

  /** Returns how many sim steps to run for this animation frame. */
  advance(now: number): number {
    if (this.last === null) {
      this.last = now;
      return 0;
    }
    this.acc += now - this.last;
    this.last = now;
    if (this.acc > STEP_MS * MAX_PENDING_STEPS) {
      // Tab was in the background or a long stall: drop the backlog, run one step.
      this.acc = STEP_MS;
    }
    let steps = 0;
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      steps++;
    }
    return steps;
  }

  reset(): void {
    this.acc = 0;
    this.last = null;
  }
}
