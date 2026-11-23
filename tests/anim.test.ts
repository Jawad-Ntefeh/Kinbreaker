import { describe, expect, it } from 'vitest';
import { getCharacter } from '../src/combat/character_data';
import { getMoveSet } from '../src/combat/move_data';
import { frameAtMoveFrame, frameAtTick, loadAnimFiles, validateAnimFile } from '../src/view/anim_data';
import { defaultLayout } from '../src/view/anim_layout';
import { selectAnim, type AnimSubject } from '../src/view/anim_select';

const rookMoves = getMoveSet('rook');
const jabFile = (frames: object[], extra: object = {}) => ({
  sheet: 'art/characters/rook.png',
  cell: [64, 96],
  pivot: [32, 92],
  sheet_cells: [8, 4],
  anims: { rook_jab: { move: 'rook_jab', frames }, ...extra },
});
const GOOD = [
  { cell: 20, dur: 4 },
  { cell: 21, dur: 5 },
  { cell: 22, dur: 2, impact: true },
  { cell: 23, dur: 6 },
  { cell: 24, dur: 7 },
];
const check = (raw: object) => validateAnimFile('data/anims/rook.json', raw, rookMoves).errors;

describe('animation validation', () => {
  it('accepts a correct file (the example from the brief)', () => {
    expect(check(jabFile(GOOD))).toEqual([]);
  });
  it('catches an impact frame that does not start on the first active frame', () => {
    const f = GOOD.map((x) => ({ ...x }));
    f[1]!.dur = 6;
    f[3]!.dur = 5;
    expect(check(jabFile(f))).toEqual(['data/anims/rook.json: rook_jab: impact starts on frame 11, move is active on frame 10']);
  });
  it('catches a wrong total', () => {
    const f = GOOD.map((x) => ({ ...x }));
    f[4]!.dur = 9;
    expect(check(jabFile(f))).toEqual(['data/anims/rook.json: rook_jab: durations add up to 26 frames, the move lasts 24']);
  });
  it('catches an impact frame shorter than the active frames', () => {
    const f = GOOD.map((x) => ({ ...x }));
    f[2]!.dur = 1;
    f[3]!.dur = 7;
    expect(check(jabFile(f))).toEqual(['data/anims/rook.json: rook_jab: impact lasts 1 frames, the move is active for 2']);
  });
  it('catches a missing cell', () => {
    const f = GOOD.map((x) => ({ ...x }));
    f[0]!.cell = 40;
    expect(check(jabFile(f))).toEqual(['data/anims/rook.json: rook_jab: frame 1: cell 40 does not exist (the sheet has 32 cells)']);
  });
  it('catches a missing or doubled impact and an unknown move', () => {
    expect(check(jabFile(GOOD.map((x) => ({ cell: x.cell, dur: x.dur })))).join()).toMatch(/exactly one frame with "impact": true, found 0/);
    expect(check({ ...jabFile(GOOD), anims: { x: { move: 'rook_nope', frames: [{ cell: 0, dur: 1 }] } } }).join()).toMatch(/move "rook_nope" does not exist/);
  });
  it('every file in data/anims/ is valid', () => {
    expect(loadAnimFiles().errors).toEqual([]);
  });
});

describe('default layout / sample file', () => {
  for (const id of ['rook', 'corvane']) {
    it(`${id}: the generated animation file passes validation for every move`, () => {
      const def = getCharacter(id);
      const moves = getMoveSet(def.moveset);
      const { json } = defaultLayout(def, moves);
      expect(validateAnimFile(`data/anims/${id}.json`, json, moves).errors).toEqual([]);
      for (const m of moves.values()) expect(json.anims[m.id], m.id).toBeDefined();
    });
  }
});

describe('playheads', () => {
  it('move animations follow the move frame; past the end they hold the last frame', () => {
    const { def } = validateAnimFile('data/anims/rook.json', jabFile(GOOD), rookMoves);
    const a = def!.anims.get('rook_jab')!;
    const seq = Array.from({ length: 24 }, (_, i) => frameAtMoveFrame(a, i + 1));
    expect(seq).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4]);
    expect(frameAtMoveFrame(a, 60)).toBe(4);
  });
  it('state animations loop or hold', () => {
    const anim = { name: 'idle', loop: true, move: null, total: 20, frames: [{ cell: 0, dur: 10, impact: false }, { cell: 1, dur: 10, impact: false }] };
    expect([0, 9, 10, 19, 20].map((t) => frameAtTick(anim, t))).toEqual([0, 0, 1, 1, 0]);
    expect(frameAtTick({ ...anim, loop: false }, 50)).toBe(1);
  });
});

describe('anim_select', () => {
  const all = (names: string[]) => (n: string) => names.includes(n);
  const f = (p: Partial<AnimSubject>): AnimSubject => ({ state: 'idle', move: null, hitHeight: null, crouchStun: false, ...p });
  it('plays the current move (each part of a multi-part move by its own id)', () => {
    expect(selectAnim(f({ state: 'attack', move: { id: 'rook_jab' } }), all(['rook_jab', 'idle']))).toEqual({ name: 'rook_jab', kind: 'move' });
    expect(selectAnim(f({ state: 'attack', move: { id: 'corvane_last_bell_3' } }), all(['corvane_last_bell_3']))!.name).toBe('corvane_last_bell_3');
    expect(selectAnim(f({ state: 'throw_attempt', move: { id: 'rook_throw' } }), all(['rook_throw']))!.name).toBe('rook_throw');
  });
  it('maps states to state animations', () => {
    const every = () => true;
    const cases: [Partial<AnimSubject>, string][] = [
      [{ state: 'walk_forward' }, 'walk_forward'],
      [{ state: 'block_crouch' }, 'block_crouch'],
      [{ state: 'hitstun', hitHeight: 'high' }, 'hitstun_high'],
      [{ state: 'hitstun', hitHeight: 'mid' }, 'hitstun_mid'],
      [{ state: 'hitstun', hitHeight: 'low' }, 'hitstun_low'],
      [{ state: 'blockstun', crouchStun: true }, 'blockstun_crouch'],
      [{ state: 'blockstun' }, 'blockstun_stand'],
      [{ state: 'defeated' }, 'ko'],
      [{ state: 'phase_transition' }, 'phase_transition'],
      [{ state: 'wall_splat' }, 'wall_splat'],
    ];
    for (const [s, name] of cases) expect(selectAnim(f(s), every)!.name).toBe(name);
    expect(selectAnim(f({}), every, 'victory')!.name).toBe('victory');
  });
  it('follows the fallback chains', () => {
    expect(selectAnim(f({ state: 'hitstun', hitHeight: 'high' }), all(['hitstun_mid', 'idle']))!.name).toBe('hitstun_mid');
    expect(selectAnim(f({ state: 'hitstun', hitHeight: 'high' }), all(['idle']))!.name).toBe('idle');
    expect(selectAnim(f({ state: 'blockstun', crouchStun: true }), all(['blockstun_stand', 'idle']))!.name).toBe('blockstun_stand');
    expect(selectAnim(f({ state: 'blockstun', crouchStun: true }), all(['block_stand', 'idle']))!.name).toBe('block_stand');
    expect(selectAnim(f({ state: 'stagger' }), all(['idle']))!.name).toBe('idle');
    expect(selectAnim(f({ state: 'attack', move: { id: 'rook_knee' } }), all(['idle']))!.name).toBe('idle');
    expect(selectAnim(f({}), all([]))).toBe(null);
  });
});
