/**
 * Sprite bank: one sheet + animation file per character. Uses the real sheet from public/art/ when
 * it exists (listed in the art manifest), otherwise a placeholder sheet generated at load.
 * The dummy uses Rook's sheet shifted to greys. Also keeps white and tinted silhouette copies of
 * each sheet for hit flashes and afterimages.
 */
import artFiles from 'virtual:art-manifest';
import { getCharacter } from '../combat/character_data';
import { getMoveSet } from '../combat/move_data';
import { loadAnimFiles, validateAnimFile, type AnimFile } from './anim_data';
import { defaultLayout, sheetSpec } from './anim_layout';
import { posePlaceholder, type Shade } from './placeholder';

export interface CharacterSprites {
  id: string;
  file: AnimFile;
  sheet: HTMLCanvasElement | HTMLImageElement;
  /** Columns in the sheet. */
  columns: number;
  placeholder: boolean;
  /** Silhouette copies by colour (white flash, gold afterimages, ...). */
  silhouettes: Map<string, HTMLCanvasElement>;
}

/** Placeholder palettes: ramps from outline to light. Red is never a character colour. */
const PALETTES: Record<string, Record<Shade, string>> = {
  rook: { outline: '#1c160c', dark: '#6e5a2a', base: '#a8873a', light: '#d8b867' }, // tarnished gold
  corvane: { outline: '#1a120b', dark: '#4e3824', base: '#7a5a3a', light: '#a8825a' }, // bronze-brown
};

const ART = new Set(artFiles.filter((f) => f.endsWith('.png') || f.endsWith('.json')));

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class SpriteBank {
  private readonly cache = new Map<string, CharacterSprites>();

  /** For shared sheets (the dummy): the base sheet the grey copy was made from. */
  private readonly greyFrom = new Map<string, CanvasImageSource>();

  get(id: string): CharacterSprites {
    let s = this.cache.get(id);
    const shared = sheetSpec(id);
    if (s && shared && shared.sheetOf !== id) {
      // Rebuild the grey copy if the base switched from placeholder to real art.
      const base = this.get(shared.sheetOf);
      if (this.greyFrom.get(id) !== base.sheet) s = undefined;
    }
    if (!s) {
      s = this.build(id);
      this.cache.set(id, s);
    }
    return s;
  }

  private build(id: string): CharacterSprites {
    const shared = sheetSpec(id);
    if (shared && shared.sheetOf !== id) {
      // The dummy: the other character's sheet, every colour shifted to grey.
      const base = this.get(shared.sheetOf);
      this.greyFrom.set(id, base.sheet);
      return { ...base, id, sheet: greyed(base), silhouettes: new Map() };
    }
    const placeholder = this.placeholder(id);
    const real = loadAnimFiles().files.get(id);
    if (!real || !ART.has(real.sheet)) return placeholder;
    // Real art: start with the placeholder, switch when the sheet has loaded and checks out.
    const img = new Image();
    const sprites = placeholder;
    img.addEventListener('load', () => {
      const cols = Math.floor(img.width / real.cell[0]);
      const rows = Math.floor(img.height / real.cell[1]);
      const def = getCharacter(id);
      const raw = { sheet: real.sheet, cell: real.cell, pivot: real.pivot, anims: Object.fromEntries([...real.anims].map(([k, a]) => [k, { loop: a.loop || undefined, move: a.move ?? undefined, frames: a.frames }])) };
      const { errors } = validateAnimFile(`data/anims/${id}.json`, raw, getMoveSet(def.moveset), cols * rows);
      if (errors.length) {
        console.warn(`Art for ${id} not used:\n${errors.join('\n')}`);
        return;
      }
      sprites.file = real;
      sprites.sheet = img;
      sprites.columns = cols;
      sprites.placeholder = false;
      sprites.silhouettes.clear();
    });
    img.src = real.sheet;
    return sprites;
  }

  private placeholder(id: string): CharacterSprites {
    const def = getCharacter(id);
    const moves = getMoveSet(def.moveset);
    const { json, cells } = defaultLayout(def, moves);
    const { def: file, errors } = validateAnimFile(`(placeholder) ${id}`, json, moves);
    if (!file) throw new Error(errors.join('\n'));
    const [cw, ch] = json.cell;
    const cols = json.sheet_cells[0];
    const c = canvas(cw * cols, ch * json.sheet_cells[1]);
    const ctx = c.getContext('2d')!;
    const pal = PALETTES[id] ?? PALETTES.rook!;
    const body = { height: def.body.height / 100, width: (def.body.halfWidth * 2) / 100, crouch: def.body.crouchHeight / 100, limbs: def.limbs, cell: json.cell, pivot: json.pivot };
    cells.forEach((key, i) => {
      const ox = (i % cols) * cw;
      const oy = Math.floor(i / cols) * ch;
      for (const r of posePlaceholder(key, body)) {
        ctx.fillStyle = pal[r.shade];
        // Clip to the cell so nothing bleeds into neighbours.
        const x0 = Math.max(0, r.x);
        const y0 = Math.max(0, r.y);
        const x1 = Math.min(cw, r.x + r.w);
        const y1 = Math.min(ch, r.y + r.h);
        if (x1 > x0 && y1 > y0) ctx.fillRect(ox + x0, oy + y0, x1 - x0, y1 - y0);
      }
    });
    return { id, file, sheet: c, columns: cols, placeholder: true, silhouettes: new Map() };
  }
}

/** A flat-colour silhouette of the sheet (hit flash, afterimages). */
export function silhouette(s: CharacterSprites, color: string): HTMLCanvasElement {
  let c = s.silhouettes.get(color);
  if (!c) {
    c = canvas(s.sheet.width, s.sheet.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(s.sheet, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    s.silhouettes.set(color, c);
  }
  return c;
}

function greyed(s: CharacterSprites): HTMLCanvasElement {
  const c = canvas(s.sheet.width, s.sheet.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(s.sheet, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.round((d[i]! * 30 + d[i + 1]! * 59 + d[i + 2]! * 11) / 100);
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
