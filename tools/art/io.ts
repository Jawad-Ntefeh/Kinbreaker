/** Image output: frames → PNG sheets, scaled previews and animated GIFs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder } = gifenc as unknown as typeof import('gifenc');

/** A frame of hex colours ('' = transparent). */
export interface Frame {
  w: number;
  h: number;
  px: string[];
}

export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** An RGBA canvas made of hex colours ('' = transparent). */
export class Canvas {
  px: string[];
  constructor(
    readonly w: number,
    readonly h: number,
    fill = '',
  ) {
    this.px = new Array(w * h).fill(fill);
  }
  set(x: number, y: number, c: string): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : '';
  }
  /** Draw a frame with its top-left at (ox, oy); transparent pixels are skipped. */
  blit(f: Frame | Canvas, ox: number, oy: number): void {
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = f.px[y * f.w + x]!;
      if (c) this.set(ox + x, oy + y, c);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  scaled(k: number): Canvas {
    const out = new Canvas(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.px[y * out.w + x] = this.px[Math.floor(y / k) * this.w + Math.floor(x / k)]!;
    return out;
  }
}

export function writePng(path: string, c: Canvas): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: c.w, height: c.h });
  for (let i = 0; i < c.px.length; i++) {
    const hex = c.px[i]!;
    if (!hex) {
      png.data[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b] = hexToRgb(hex);
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

/** Animated GIF: frames (same size) with durations in sim frames (60 per second). */
export function writeGif(path: string, frames: { canvas: Canvas; dur: number }[], background: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const colours = [background, ...new Set(frames.flatMap((f) => f.canvas.px.filter((c) => c && c !== background)))];
  if (colours.length > 256) throw new Error(`${path}: more than 256 colours`);
  const palette = colours.map((c) => hexToRgb(c) as number[]);
  const index = new Map(colours.map((c, i) => [c, i]));
  const gif = GIFEncoder();
  for (const { canvas, dur } of frames) {
    const data = new Uint8Array(canvas.w * canvas.h);
    for (let i = 0; i < data.length; i++) data[i] = index.get(canvas.px[i] || background)!;
    gif.writeFrame(data, canvas.w, canvas.h, { palette, delay: Math.round((dur * 1000) / 60), repeat: 0 });
  }
  gif.finish();
  writeFileSync(path, gif.bytes());
}

/** Tiny 3x5 pixel font for labels on review sheets. */
const FONT: Record<string, string> = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100110101010', '7': '111001010010010', '8': '010101010101010',
  '9': '010101011001110', '_': '000000000000111', '/': '001001010100100', '.': '000000000000010', '-': '000000111000000',
  '+': '000010111010000', '@': '010101111100011', ':': '000010000010000', ' ': '000000000000000', '*': '000101010101000',
};

export function label(c: Canvas, text: string, x: number, y: number, colour: string): void {
  let cx = x;
  for (const ch of text.toLowerCase()) {
    const g = FONT[ch] ?? FONT[' ']!;
    for (let i = 0; i < 15; i++) if (g[i] === '1') c.set(cx + (i % 3), y + Math.floor(i / 3), colour);
    cx += 4;
  }
}
