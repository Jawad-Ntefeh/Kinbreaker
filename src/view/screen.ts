/**
 * Screen: owns the 640x360 offscreen canvas the game draws into, and scales it
 * to the visible canvas by the largest whole number that fits, letterboxed in black.
 */
export const BASE_WIDTH = 640;
export const BASE_HEIGHT = 360;

export class Screen {
  readonly display: HTMLCanvasElement;
  readonly displayCtx: CanvasRenderingContext2D;
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Integer scale factor from base pixels to device pixels. */
  scale = 1;
  /** Top-left of the scaled image on the display canvas, in device pixels. */
  offsetX = 0;
  offsetY = 0;

  constructor(display: HTMLCanvasElement) {
    this.display = display;
    this.displayCtx = get2d(display);
    this.buffer = document.createElement('canvas');
    this.buffer.width = BASE_WIDTH;
    this.buffer.height = BASE_HEIGHT;
    this.ctx = get2d(this.buffer);
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.display.width = w;
    this.display.height = h;
    this.scale = Math.max(1, Math.min(Math.floor(w / BASE_WIDTH), Math.floor(h / BASE_HEIGHT)));
    this.offsetX = Math.floor((w - BASE_WIDTH * this.scale) / 2);
    this.offsetY = Math.floor((h - BASE_HEIGHT * this.scale) / 2);
    this.displayCtx.imageSmoothingEnabled = false;
  }

  /** Copy the offscreen buffer to the display, scaled and letterboxed. */
  present(): void {
    const d = this.displayCtx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.imageSmoothingEnabled = false;
    d.fillStyle = '#000';
    d.fillRect(0, 0, this.display.width, this.display.height);
    d.drawImage(
      this.buffer,
      0,
      0,
      BASE_WIDTH,
      BASE_HEIGHT,
      this.offsetX,
      this.offsetY,
      BASE_WIDTH * this.scale,
      BASE_HEIGHT * this.scale,
    );
  }

  /**
   * Set the display context so that drawing uses base-resolution coordinates.
   * Used for crisp debug text on top of the pixel-art image.
   */
  beginOverlay(): CanvasRenderingContext2D {
    const d = this.displayCtx;
    d.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    return d;
  }
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}
