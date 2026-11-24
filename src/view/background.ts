/**
 * Arena backgrounds: parallax layers from data/arenas/<id>.json. Uses the real image when it
 * exists in public/art/ (art manifest), otherwise a placeholder generated here, in whole pixels
 * with a few flat colours (no gradients). View only.
 */
import artFiles, { artUrl } from 'virtual:art-manifest';
import type { ArenaDef } from '../combat/arena_data';
import type { CombatSim } from '../combat/combat_sim';
import type { Camera } from './camera';
import { FLOOR_Y } from './camera';
import { BASE_HEIGHT, BASE_WIDTH } from './screen';

const ART = new Set(artFiles);
/** Placeholder layer width (tiles horizontally when the layer repeats). */
const TILE = 640;

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
      g.fillRect(0, i * 53, BASE_WIDTH, BASE_HEIGHT - i * 53);
    });
    // Stars.
    const r = noise(7);
    g.fillStyle = '#3a3850';
    for (let i = 0; i < 70; i++) g.fillRect(Math.floor(r() * BASE_WIDTH), Math.floor(r() * 160), 1, 1);
    // A pale moon (pixel disc) with a darker crater or two.
    const [mx, my, mr] = [496, 61, 19];
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
      const top = 147 + tier * 29;
      g.fillStyle = ['#1a1824', '#1d1b28', '#201d2b', '#23202f'][tier]!;
      let x = 0;
      while (x < TILE) {
        const w = 27 + Math.floor(r() * 67);
        const broken = r() < 0.25;
        const h = broken ? Math.floor(r() * 13) : 0;
        g.fillRect(x, top + h, w, FLOOR_Y - top - h);
        // Arches along the top tier.
        if (tier === 0 && !broken) {
          g.fillStyle = '#121019';
          for (let ax = x + 5; ax + 8 < x + w; ax += 16) g.fillRect(ax, top + 8, 8, 12);
          g.fillStyle = '#1a1824';
        }
        x += w + (broken ? Math.floor(r() * 16) : 0);
      }
    }
    return c;
  },
  columns: () => {
    const [c, g] = canvas(TILE, BASE_HEIGHT);
    const cols: [number, number][] = [[53, 173], [267, 120], [440, 213]];
    for (const [x, h] of cols) {
      g.fillStyle = '#0f0e13';
      g.fillRect(x, FLOOR_Y - h, 35, h);
      g.fillRect(x - 5, FLOOR_Y - h, 45, 8); // capital
      g.fillRect(x - 7, FLOOR_Y - 8, 48, 8); // base
      g.fillStyle = '#16141c';
      g.fillRect(x + 5, FLOOR_Y - h + 11, 4, h - 19); // flute highlight
      g.fillStyle = '#0f0e13';
      g.fillRect(x + 24, FLOOR_Y - h - 11, 11, 11); // jagged break
      g.fillRect(x + 29, FLOOR_Y - h - 16, 5, 5);
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
    for (let x = 0; x < TILE; x += 43) g.fillRect(x, FLOOR_Y + 3, 13, 1);
    g.fillStyle = '#16141c';
    for (let x = 0; x < TILE; x += 64) g.fillRect(x, FLOOR_Y + 9, 1, BASE_HEIGHT - FLOOR_Y - 9);
    for (let x = 32; x < TILE; x += 64) g.fillRect(x, FLOOR_Y + 24, 1, BASE_HEIGHT - FLOOR_Y - 24);
    return c;
  },
  wall_intact: () => {
    // Drawn so its right edge is the wall (x = 32 in the image).
    const [c, g] = canvas(43, BASE_HEIGHT);
    g.fillStyle = '#2c2934';
    g.fillRect(0, 0, 43, FLOOR_Y + 1);
    g.fillStyle = '#24212c';
    for (let y = 5; y < FLOOR_Y; y += 19) {
      g.fillRect(0, y, 43, 1);
      for (let x = ((y - 5) / 19) % 2 ? 5 : 16; x < 43; x += 21) g.fillRect(x, y, 1, 19);
    }
    g.fillStyle = '#3a3646';
    g.fillRect(42, 0, 1, FLOOR_Y + 1);
    return c;
  },
  wall_broken: () => {
    // Rubble and a jagged stump where the wall stood (right edge = the old wall).
    const [c, g] = canvas(64, BASE_HEIGHT);
    g.fillStyle = '#2c2934';
    const stump = [93, 85, 77, 81, 69, 63, 53, 59];
    stump.forEach((h, i) => g.fillRect(21 + i * 5, FLOOR_Y + 1 - h, 5, h));
    g.fillStyle = '#3a3646';
    for (const [x, y, w, h] of [[3, -11, 12, 11], [13, -7, 9, 7], [53, -8, 11, 8], [40, -13, 8, 5], [27, -5, 7, 5]] as const) g.fillRect(x, FLOOR_Y + 1 + y, w, h);
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
      real.src = artUrl(path);
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
