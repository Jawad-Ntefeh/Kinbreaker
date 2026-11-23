/** Dev tool (sprites.html): shows each character's sheet with cell numbers and animation names. */
import { SpriteBank } from '../src/view/sprites';

const bank = new SpriteBank();
const out = document.getElementById('out')!;
const SCALE = 3;
for (const id of ['rook', 'corvane', 'dummy']) {
  const s = bank.get(id);
  const [cw, ch] = s.file.cell;
  const names = new Map<number, string>();
  for (const a of s.file.anims.values()) a.frames.forEach((f, i) => names.set(f.cell, `${a.name}${a.frames.length > 1 ? ` ${i + 1}` : ''}${f.impact ? ' *' : ''}`));
  const h = document.createElement('h3');
  h.textContent = `${id}: ${s.placeholder ? 'placeholder' : s.file.sheet}, cell ${cw}x${ch}, pivot ${s.file.pivot}`;
  out.appendChild(h);
  const c = document.createElement('canvas');
  c.width = s.sheet.width * SCALE;
  c.height = s.sheet.height * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1d1b24';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(s.sheet, 0, 0, c.width, c.height);
  ctx.font = '10px monospace';
  const rows = Math.ceil(s.sheet.height / ch);
  for (let i = 0; i < s.columns * rows; i++) {
    const x = (i % s.columns) * cw * SCALE;
    const y = Math.floor(i / s.columns) * ch * SCALE;
    ctx.strokeStyle = '#333';
    ctx.strokeRect(x + 0.5, y + 0.5, cw * SCALE - 1, ch * SCALE - 1);
    ctx.fillStyle = '#888';
    ctx.fillText(`${i} ${names.get(i) ?? ''}`, x + 3, y + 11);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + s.file.pivot[0] * SCALE - 3, y + s.file.pivot[1] * SCALE, 7, 1);
  }
  out.appendChild(c);
}
