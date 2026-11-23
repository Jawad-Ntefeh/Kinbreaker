import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * `virtual:art-manifest`: the list of files under public/art/, so the game only requests images
 * that exist (a missing image would be a 404 in the console). Placeholders are used for the rest.
 */
function artManifest(): Plugin {
  const id = 'virtual:art-manifest';
  const resolved = '\0' + id;
  const root = join(process.cwd(), 'public');
  const list = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((n) => {
          const p = join(dir, n);
          return statSync(p).isDirectory() ? list(p) : [relative(root, p).split('\\').join('/')];
        })
      : [];
  return {
    name: 'art-manifest',
    resolveId: (source) => (source === id ? resolved : null),
    load: (source) => (source === resolved ? `export default ${JSON.stringify(list(join(root, 'art')))};` : null),
    configureServer(server) {
      server.watcher.add(join(root, 'art'));
      server.watcher.on('all', (_e, file) => {
        if (file.includes(join('public', 'art'))) {
          const mod = server.moduleGraph.getModuleById(resolved);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, desktop wrapper).
  base: './',
  plugins: [artManifest()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
