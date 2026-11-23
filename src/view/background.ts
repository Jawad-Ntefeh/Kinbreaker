/**
 * Arena backgrounds: parallax layers from data/arenas/<id>.json. Uses the real image when it
 * exists in public/art/ (art manifest), otherwise a placeholder generated here, in whole pixels
 * with a few flat colours (no gradients). View only.
 */
import artFiles from 'virtual:art-manifest';
import type { ArenaDef } from '../combat/arena_data';
import type { CombatSim } from '../combat/combat_sim';
import type { Camera } from './camera';
import { FLOOR_Y } from './camera';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

const ART = new Set(artFiles);
/** Placeholder layer width (tiles horizontally when the layer repeats). */
const TILE = 480;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Small deterministic noise for placeholder layouts. */
function noise(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
}

const GENERATORS: Record<string, () => HTMLCanvasElement> = {
  sky: () => {
    const [c, g] = canvas(BASE_WIDTH, BASE_HEIGHT);
    // Stepped bands, darkest at the top.
    const bands = ['#0b0a12', '#0e0d17', '#11101b', '#14121f', '#171523'];
    bands.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, i * 40, BASE_WIDTH, BASE_HEIGHT - i * 40);
    });
    // Stars.
    const r = noise(7);
    g.fillStyle = '#3a3850';
    for (let i = 0; i < 40; i++) g.fillRect(Math.floor(r() * BASE_WIDTH), Math.floor(r() * 120), 1, 1);
    // A pale moon (pixel disc) with a darker crater or two.
    const [mx, my, mr] = [372, 46, 14];
    for (let y = -mr; y <= mr; y++) {
      const w = Math.floor(Math.sqrt(mr * mr - y * y));
      g.fillStyle = '#c9c4b2';
      g.fillRect(mx - w, my + y, w * 2 + 1, 1);
    }
    g.fillStyle = '#a9a492';
    g.fillRect(mx - 5, my - 3, 4, 3);
    g.fillRect(mx + 3, my + 4, 3, 3);
    g.fillRect(mx - 1, my + 7, 2, 2);
    return c;
  },
  stands: () => {
    const [c, g] = canvas(TILE, BASE_HEIGHT);
    const r = noise(21);
    // Distant tiered stands, broken in places.
    for (let tier = 0; tier < 4; tier++) {
      const top = 110 + tier * 22;
      g.fillStyle = ['#1a1824', '#1d1b28', '#201d2b', '#23202f'][tier]!;
      let x = 0;
      while (x < TILE) {
        const w = 20 + Math.floor(r() * 50);
        const broken = r() < 0.25;
        const h = broken ? Math.floor(r() * 10) : 0;
        g.fillRect(x, top + h, w, FLOOR_Y - top - h);
        // Arches along the top tier.
        if (tier === 0 && !broken) {
          g.fillStyle = '#121019';
          for (let ax = x + 4; ax + 6 < x + w; ax += 12) g.fillRect(ax, top + 6, 6, 9);
          g.fillStyle = '#1a1824';
        }
        x += w + (broken ? Math.floor(r() * 12) : 0);
      }
    }
    return c;
  },
  columns: () => {
    const [c, g] = canvas(TILE, BASE_HEIGHT);
    const cols: [number, number][] = [[40, 130], [200, 90], [330, 160]];
    for (const [x, h] of cols) {
      g.fillStyle = '#0f0e13';
      g.fillRect(x, FLOOR_Y - h, 26, h);
      g.fillRect(x - 4, FLOOR_Y - h, 34, 6); // capital
      g.fillRect(x - 5, FLOOR_Y - 6, 36, 6); // base
      g.fillStyle = '#16141c';
      g.fillRect(x + 4, FLOOR_Y - h + 8, 3, h - 14); // flute highlight
      g.fillStyle = '#0f0e13';
      g.fillRect(x + 18, FLOOR_Y - h - 8, 8, 8); // jagged break
      g.fillRect(x + 22, FLOOR_Y - h - 12, 4, 4);
    }
    return c;
  },
  floor: () => {
    const [c, g] = canvas(TILE, BASE_HEIGHT);
    g.fillStyle = '#4a4656';
    g.fillRect(0, FLOOR_Y, TILE, 1);
    g.fillStyle = '#1d1b24';
    g.fillRect(0, FLOOR_Y + 1, TILE, BASE_HEIGHT - FLOOR_Y - 1);
    // Shallow water line and flagstone joints.
    g.fillStyle = '#1f3240';
    g.fillRect(0, FLOOR_Y + 2, TILE, 3);
    g.fillStyle = '#3d6077';
    for (let x = 0; x < TILE; x += 32) g.fillRect(x, FLOOR_Y + 2, 10, 1);
    g.fillStyle = '#16141c';
    for (let x = 0; x < TILE; x += 48) g.fillRect(x, FLOOR_Y + 7, 1, BASE_HEIGHT - FLOOR_Y - 7);
    for (let x = 24; x < TILE; x += 48) g.fillRect(x, FLOOR_Y + 18, 1, BASE_HEIGHT - FLOOR_Y - 18);
    return c;
  },
  wall_intact: () => {
    // Drawn so its right edge is the wall (x = 32 in the image).
    const [c, g] = canvas(32, BASE_HEIGHT);
    g.fillStyle = '#2c2934';
    g.fillRect(0, 0, 32, FLOOR_Y + 1);
    g.fillStyle = '#24212c';
    for (let y = 4; y < FLOOR_Y; y += 14) {
      g.fillRect(0, y, 32, 1);
      for (let x = (y / 14) % 2 ? 4 : 12; x < 32; x += 16) g.fillRect(x, y, 1, 14);
    }
    g.fillStyle = '#3a3646';
    g.fillRect(31, 0, 1, FLOOR_Y + 1);
    return c;
  },
  wall_broken: () => {
    // Rubble and a jagged stump where the wall stood (right edge = the old wall).
    const [c, g] = canvas(48, BASE_HEIGHT);
    g.fillStyle = '#2c2934';
    const stump = [70, 64, 58, 61, 52, 47, 40, 44];
    stump.forEach((h, i) => g.fillRect(16 + i * 4, FLOOR_Y + 1 - h, 4, h));
    g.fillStyle = '#3a3646';
    for (const [x, y, w, h] of [[2, -8, 9, 8], [10, -5, 7, 5], [40, -6, 8, 6], [30, -10, 6, 4], [20, -4, 5, 4]] as const) g.fillRect(x, FLOOR_Y + 1 + y, w, h);
    return c;
  },
};

export class Backgrounds {
  private readonly images = new Map<string, CanvasImageSource & { width: number; height: number }>();

  /** The image for a path: the real file if it exists and has loaded, else a placeholder. */
  private image(path: string): (CanvasImageSource & { width: number; height: number }) | null {
    let img = this.images.get(path);
    if (img) return img;
    const name = path.split('/').pop()!.replace(/\.png$/, '');
    const gen = GENERATORS[name];
    img = gen ? gen() : undefined;
    if (ART.has(path)) {
      const real = new Image();
      real.addEventListener('load', () => this.images.set(path, real));
      real.src = path;
    }
    if (img) this.images.set(path, img);
    return img ?? null;
  }

  /** Draw the arena's layers back to front, and the left wall (intact or broken). */
  draw(ctx: CanvasRenderingContext2D, arena: ArenaDef, sim: CombatSim, cam: Camera): boolean {
    if (!arena.layers.length) return false;
    for (const layer of arena.layers) {
      const img = this.image(layer.image);
      if (!img) continue;
      // Parallax: the layer moves with this fraction of the camera; screen shake applies to all.
      const ox = -Math.round((cam.x - cam.shakeX) * layer.parallax) - cam.shakeX;
      const y = layer.y + cam.shakeY;
      if (layer.repeat) {
        const w = img.width;
        let x = ((ox % w) + w) % w - w;
        for (; x < BASE_WIDTH; x += w) ctx.drawImage(img, x, y);
      } else ctx.drawImage(img, ox, y);
    }
    if (arena.leftWall) {
      const path = sim.wallBroken ? arena.leftWall.broken : arena.leftWall.intact;
      const img = this.image(path);
      // The original wall stood at arena x = 0 (the arena's starting left edge).
      if (img) ctx.drawImage(img, cam.sx(0) - img.width, cam.shakeY);
    }
    return true;
  }
}
