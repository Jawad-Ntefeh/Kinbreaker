/** Seeded RNG owned by the sim (xorshift32). Deterministic: same seed → same sequence. */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }

  /** True with probability percent/100. */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  /** Integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
}
