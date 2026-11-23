import { describe, expect, it } from 'vitest';
import { formatError, loadMoveFiles, parseInput, validateMove } from '../src/combat/move_data';

const base = () => ({
  id: 'x_jab',
  name: 'Jab',
  limb: 'left_arm',
  input: '1',
  startup: 10,
  active: 2,
  recovery: 13,
  damage: 7,
  poise_damage: 4,
  height: 'high',
  path: 'linear',
  on_block: 1,
  on_hit: 8,
  on_counter_hit: 8,
  properties: [],
  hitboxes: [{ frames: [10, 11], x: 18, y: 52, w: 26, h: 10 }],
  hurtbox_overrides: [],
  movement: [],
  cancel_into: [],
  cancel_window: null,
  cancel_on: [],
});

const problems = (raw: unknown) =>
  validateMove('data/moves/x/x_jab.json', 'x', raw).errors.map((e) => `${e.field}: ${e.problem}`);

describe('parseInput', () => {
  it('parses plain buttons, held directions, motions and pairs', () => {
    expect(parseInput('1')).toEqual({ motion: null, dir: null, buttons: ['1'] });
    expect(parseInput('3:4')).toEqual({ motion: null, dir: 3, buttons: ['4'] });
    expect(parseInput('236:2')).toEqual({ motion: '236', dir: null, buttons: ['2'] });
    expect(parseInput('1+3')).toEqual({ motion: null, dir: null, buttons: ['1', '3'] });
  });
  it('rejects invalid input strings', () => {
    expect(typeof parseInput('5')).toBe('string');
    expect(typeof parseInput('')).toBe('string');
    expect(typeof parseInput('0:1')).toBe('string');
    expect(typeof parseInput('2:5')).toBe('string');
    expect(typeof parseInput('a:1')).toBe('string');
    expect(typeof parseInput('1+1')).toBe('string');
    expect(typeof parseInput('2:')).toBe('string');
  });
});

describe('validateMove', () => {
  it('accepts a valid move and converts px to subpixels', () => {
    const { move, errors } = validateMove('data/moves/x/x_jab.json', 'x', base());
    expect(errors).toEqual([]);
    expect(move!.hitboxes[0]).toMatchObject({ x: 1800, y: 5200, w: 2600, h: 1000 });
    expect(move!.total).toBe(24);
    expect(move!.lastActive).toBe(11);
  });
  it('reports missing fields', () => {
    const raw: Record<string, unknown> = base();
    delete raw.startup;
    expect(problems(raw)).toContain('startup: missing');
  });
  it('reports unknown enum values', () => {
    expect(problems({ ...base(), height: 'overhead' }).join()).toMatch(/height: unknown value "overhead"/);
    expect(problems({ ...base(), path: 'curvy' }).join()).toMatch(/path: unknown value/);
    expect(problems({ ...base(), limb: 'tail' }).join()).toMatch(/limb: unknown value/);
    expect(problems({ ...base(), properties: ['launcher', 'spin'] }).join()).toMatch(/properties\[1\]: unknown value "spin"/);
  });
  it('reports hitbox frames outside the active window', () => {
    const raw = { ...base(), hitboxes: [{ frames: [9, 11], x: 0, y: 0, w: 1, h: 1 }] };
    expect(problems(raw).join()).toMatch(/hitboxes\[0\]\.frames: frames \[9, 11\] are outside the active window \[10, 11\]/);
  });
  it('reports an invalid input string', () => {
    expect(problems({ ...base(), input: '2:7' }).join()).toMatch(/input: invalid input "2:7"/);
  });
  it('reports unknown fields (typos)', () => {
    expect(problems({ ...base(), recovry: 3 })).toContain('recovry: unknown field');
  });
  it('requires break and range on throws', () => {
    const raw = { ...base(), height: 'throw', on_block: null, on_hit: 'knockdown', hitboxes: [] };
    const p = problems(raw).join('\n');
    expect(p).toMatch(/break:/);
    expect(p).toMatch(/range:/);
  });
});

describe('loadMoveFiles', () => {
  it('reports a cancel_into that references a missing move, with the file name', () => {
    const { errors } = loadMoveFiles({
      '../../data/moves/x/x_jab.json': { ...base(), cancel_into: ['x_nope'], cancel_window: [12, 20], cancel_on: ['hit'] },
    });
    expect(errors.map(formatError)).toEqual([
      'data/moves/x/x_jab.json: cancel_into[0]: move "x_nope" does not exist for x',
    ]);
  });
  it('groups moves by character', () => {
    const { sets, errors } = loadMoveFiles({ '../../data/moves/x/x_jab.json': base() });
    expect(errors).toEqual([]);
    expect(sets.get('x')!.get('x_jab')!.name).toBe('Jab');
  });
});

describe('new move fields', () => {
  it('accepts glint, armor_frames, whiff_recovery and continue_on', () => {
    const { move, errors } = validateMove('data/moves/x/x_jab.json', 'x', {
      ...base(), startup: 20, hitboxes: [{ frames: [20, 21], x: 0, y: 0, w: 1, h: 1 }],
      glint: true, armor_frames: [1, 19], whiff_recovery: 40, continue_on: ['hit', 'block'],
    });
    expect(errors).toEqual([]);
    expect(move).toMatchObject({ glint: true, armorFrames: [1, 19], whiffRecovery: 40, continueOn: ['hit', 'block'] });
  });
  it('defaults: no glint, no armor, no whiff recovery, not a continuation', () => {
    const { move } = validateMove('data/moves/x/x_jab.json', 'x', base());
    expect(move).toMatchObject({ glint: false, armorFrames: null, whiffRecovery: 0, continueOn: [] });
  });
  it('reports bad values', () => {
    const p = problems({ ...base(), glint: 'yes', armor_frames: [5, 99], whiff_recovery: -1, continue_on: ['always'] }).join('\n');
    expect(p).toMatch(/glint: must be true or false/);
    expect(p).toMatch(/armor_frames: frames \[5, 99\] are outside the move/);
    expect(p).toMatch(/whiff_recovery: must be >= 0/);
    expect(p).toMatch(/continue_on\[0\]: unknown value "always"/);
  });
});

describe('character files', () => {
  it('every file in data/characters/ loads and validates', async () => {
    const { loadAllCharacters } = await import('../src/combat/character_data');
    const { defs, errors } = loadAllCharacters();
    expect(errors).toEqual([]);
    expect(defs.get('rook')!.limbs.right_arm).toBe(false);
    expect(defs.get('dummy')!.limbs.right_arm).toBe(true);
    expect(defs.get('rook')!.body).toEqual({ halfWidth: 1600, height: 10700, crouchHeight: 6700 });
  });
  it('reports missing and invalid fields', async () => {
    const { validateCharacter } = await import('../src/combat/character_data');
    const { errors } = validateCharacter('data/characters/x.json', { id: 'x', name: 'X', moveset: 'rook', health: -5, limbs: {} });
    const p = errors.map((e) => `${e.field}: ${e.problem}`).join('\n');
    expect(p).toMatch(/health: must be >= 1/);
    expect(p).toMatch(/poise: missing/);
    expect(p).toMatch(/hurtbox.width: missing/);
    expect(p).toMatch(/limbs.left_arm: must be true or false/);
  });
});

describe('derived stun', () => {
  it('rejects a recovery too short for the authored advantage', () => {
    const p = problems({ ...base(), on_block: -18, recovery: 12 }).join('\n');
    expect(p).toMatch(/on_block: -18 needs at least 18 recovery frames/);
  });
});
