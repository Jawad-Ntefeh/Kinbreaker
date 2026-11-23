/** Text helpers for the overlay layer (drawn at display resolution in base coordinates). */
export const FONT = '8px ui-monospace, Menlo, Consolas, monospace';

export function font(size: number): string {
  return FONT.replace('8px', `${size}px`);
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillText(s, x + 0.35, y + 0.35);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Dim the whole screen. */
export function dim(ctx: CanvasRenderingContext2D, alpha: number, w: number, h: number): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

/** A vertical list of options with the selected one highlighted. */
export function drawMenu(ctx: CanvasRenderingContext2D, options: readonly string[], selected: number, cx: number, y: number, size = 11): void {
  ctx.font = font(size);
  options.forEach((opt, i) => {
    const sel = i === selected;
    text(ctx, sel ? `▸ ${opt} ◂` : opt, cx, y + i * (size + 8), sel ? '#d8b867' : '#9a9aa8', 'center');
  });
}
