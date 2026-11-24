/// <reference types="vite/client" />

declare module 'virtual:art-manifest' {
  /** Files under public/art/, relative to public/ (e.g. "art/characters/rook.png"). */
  const files: string[];
  export default files;
  /** The file's URL with a content fingerprint (?v=hash), so updated art is never served from cache. */
  export function artUrl(file: string): string;
}
