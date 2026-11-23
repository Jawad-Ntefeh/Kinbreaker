/// <reference types="vite/client" />

declare module 'virtual:art-manifest' {
  /** Files under public/art/, relative to public/ (e.g. "art/characters/rook.png"). */
  const files: string[];
  export default files;
}
