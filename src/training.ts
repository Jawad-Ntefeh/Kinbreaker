/**
 * Training scene: Rook vs the training dummy, with the debug overlay, pause and frame step.
 */
import { DummyController } from './ai/dummy';
import { CombatSim } from './combat/combat_sim';
import { ALL_LIMBS } from './combat/fighter';
import { getMoveSet } from './combat/move_data';
import { SYSTEM } from './combat/system';
import { keyLabel, type DebugAction } from './input/bindings';
import { InputManager } from './input/input_manager';
import { DebugOverlay, FONT } from './view/debug_overlay';
import { Renderer } from './view/renderer';
import { BASE_HEIGHT, BASE_WIDTH, type Screen } from './view/screen';

export class TrainingScene {
  sim: CombatSim;
  readonly dummy = new DummyController(1);
  readonly renderer = new Renderer();
  readonly overlay = new DebugOverlay();
  /** Paused with P (debug). */
  debugPaused = false;
  /** Paused because the canvas lost focus. */
  focusPaused = false;
  /** Paused with Escape / Start (menu placeholder). */
  menuPaused = false;
  private readonly debugCodes: Map<string, DebugAction>;
  private readonly pauseCodes: Set<string>;

  constructor(
    readonly input: InputManager,
    canvas: HTMLCanvasElement,
  ) {
    this.sim = TrainingScene.newSim();
    const k = input.bindings.keyboard;
    this.debugCodes = new Map();
    for (const [action, codes] of Object.entries(k.debug) as [DebugAction, string[]][]) {
      for (const c of codes) this.debugCodes.set(c, action);
    }
    this.pauseCodes = new Set(k.meta.pause);
    input.keyboard.onKeyDown = (code) => this.onKey(code);

    canvas.addEventListener('blur', () => {
      this.focusPaused = true;
      input.keyboard.clear();
    });
    canvas.addEventListener('focus', () => (this.focusPaused = false));
    canvas.addEventListener('mousedown', () => canvas.focus());
    canvas.focus();
    if (!document.hasFocus() || document.activeElement !== canvas) this.focusPaused = true;
  }

  static newSim(): CombatSim {
    const moves = getMoveSet('rook');
    return new CombatSim({
      p1: { name: 'Rook', moves, ...SYSTEM.fighters.rook!, limbs: { ...ALL_LIMBS, right_arm: false } },
      p2: { name: 'Dummy', moves, ...SYSTEM.fighters.dummy!, limbs: { ...ALL_LIMBS } },
      p1X: 420,
      p2X: 540,
      trainingRefill: true,
    });
  }

  get paused(): boolean {
    return this.debugPaused || this.focusPaused || this.menuPaused;
  }

  private onKey(code: string): void {
    if (this.pauseCodes.has(code)) {
      this.menuPaused = !this.menuPaused;
      return;
    }
    switch (this.debugCodes.get(code)) {
      case 'toggleOverlay':
        this.overlay.visible = !this.overlay.visible;
        break;
      case 'debugPause':
        this.debugPaused = !this.debugPaused;
        break;
      case 'frameStep':
        if (this.debugPaused && !this.focusPaused) this.stepOnce();
        break;
      case 'cycleDummy':
        this.dummy.cycleMode();
        break;
    }
  }

  /** Called once per animation frame for edge-triggered controller buttons. */
  pollMeta(): void {
    if (this.input.gamepad.metaPressed('pause')) this.menuPaused = !this.menuPaused;
  }

  /** Advance the sim by exactly one frame. */
  stepOnce(): void {
    const p1 = this.input.sample();
    const p2 = this.dummy.update(this.sim);
    this.sim.step(p1, p2);
  }

  controlsLine(): string {
    if (this.input.lastDevice === 'gamepad') {
      return 'D-pad/stick move · X Y A B attack · RB phase · Start pause · ` debug · P pause · O step · T dummy';
    }
    const k = this.input.bindings.keyboard;
    const l = (codes: string[]) => keyLabel(codes[0]!);
    const move = [k.dirs.up, k.dirs.left, k.dirs.down, k.dirs.right].map(l).join('');
    const attack = [k.buttons['1'], k.buttons['2'], k.buttons['3'], k.buttons['4']].map(l).join(' ');
    return `${move} move · ${attack} attack · ${l(k.buttons.phase)} phase · ${l(k.debug.debugPause)} pause · ${l(k.debug.frameStep)} step · ${l(k.debug.cycleDummy)} dummy mode`;
  }

  render(screen: Screen, simFps: number): void {
    const ctx = screen.ctx;
    this.renderer.draw(ctx, this.sim);
    this.overlay.drawBoxes(ctx, this.sim, this.renderer);
    screen.present();
    const o = screen.beginOverlay();
    this.overlay.drawText(o, this.sim, {
      simFps,
      dummyMode: this.dummy.mode,
      paused: this.menuPaused ? 'PAUSED  (Esc / Start to resume)' : this.debugPaused ? 'PAUSED  (P resume · O step one frame)' : null,
      controls: this.controlsLine(),
    });
    if (this.focusPaused) {
      o.fillStyle = 'rgba(0,0,0,0.6)';
      o.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      o.font = FONT.replace('6px', '10px');
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = '#fff';
      o.fillText('Click to resume', BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }
  }
}

