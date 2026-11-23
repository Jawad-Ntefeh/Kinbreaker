declare module 'gifenc' {
  const def: unknown;
  export default def;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: number[][]; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
