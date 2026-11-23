/** Fight statistics (run with `npm run stats`). Prints a summary; asserts nothing. */
import { describe, it } from 'vitest';
import { MasherBot, PerfectBot, runFight, type Bot } from './bots';

describe.skipIf(!process.env.FIGHT_STATS)('fight stats', () => {
  it('perfect bot and button-masher vs Corvane', () => {
    const N = Number(process.env.FIGHT_STATS_N ?? 50);
    for (const [name, mk] of [['perfect', () => new PerfectBot()], ['masher', (s: number) => new MasherBot(s * 7 + 3)]] as [string, (s: number) => Bot][]) {
      let wins = 0;
      let rookWins = 0;
      let frames = 0;
      let p2 = 0;
      const moves = new Map<string, number>();
      for (let seed = 1; seed <= N; seed++) {
        const r = runFight(seed, mk(seed), 20000);
        if (r.winner === 'corvane') wins++;
        if (r.winner === 'rook') rookWins++;
        frames += r.frames;
        if (r.sim.fighters[1].phase === 2) p2++;
        for (const e of r.ai.log) if (e.type === 'opener' || e.type === 'punish' || e.type === 'ember' || e.type === 'ground_hit') {
          const k = e.type === 'opener' ? e.opener! : e.type;
          moves.set(k, (moves.get(k) ?? 0) + 1);
        }
      }
      process.stdout.write(
        `${name}: Corvane wins ${wins}/${N} (${Math.round((wins * 100) / N)}%), Rook wins ${rookWins}, timeouts ${N - wins - rookWins}; ` +
          `avg ${Math.round(frames / N)} frames (${(frames / N / 60).toFixed(1)} s); reached phase 2 in ${p2}/${N}\n` +
          `  usage: ${[...moves].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}\n`,
      );
    }
  });
});
