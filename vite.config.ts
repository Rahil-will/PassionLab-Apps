import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

/**
 * Maps every named export of the lucide-react barrel (including aliases such as
 * `AlertCircle` -> circle-alert) to its individual icon module.
 */
function loadLucideIconModules(): Map<string, string> {
  const map = new Map<string, string>();
  let barrelPath: string;
  try {
    barrelPath = require.resolve('lucide-react/dist/esm/lucide-react.js');
  } catch {
    barrelPath = path.resolve(__dirname, 'node_modules/lucide-react/dist/esm/lucide-react.js');
  }
  if (!fs.existsSync(barrelPath)) return map;

  const barrel = fs.readFileSync(barrelPath, 'utf8');
  const exportRe = /export\s*\{([^}]*)\}\s*from\s*['"]\.\/(icons\/[^'"]+)['"]/g;
  for (const match of barrel.matchAll(exportRe)) {
    const specifier = `lucide-react/dist/esm/${match[2]}`;
    for (const entry of match[1].split(',')) {
      const alias = entry.trim().match(/^default\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) map.set(alias[1], specifier);
    }
  }
  return map;
}

/**
 * Rewrites `import { Icon } from 'lucide-react'` to per-icon modules so Rollup
 * never walks the ~1670-module barrel. Application sources stay unchanged.
 */
function lucideIconImports(): Plugin {
  let icons: Map<string, string> | null = null;
  const unresolved = new Set<string>();

  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"])lucide-react\3\s*;?/g;

  return {
    name: 'prodigi:lucide-icon-imports',
    enforce: 'pre',
    buildStart() {
      icons = loadLucideIconModules();
      unresolved.clear();
      if (icons.size === 0) {
        this.warn('lucide-react barrel not found; icon imports left untouched.');
      }
    },
    transform(code, id) {
      if (!icons || icons.size === 0) return null;
      if (id.includes('node_modules')) return null;
      if (!/\.[jt]sx?$/.test(id.split('?')[0])) return null;
      if (!code.includes('lucide-react')) return null;

      let changed = false;
      const next = code.replace(importRe, (statement, typeOnly: string | undefined, body: string) => {
        if (typeOnly) return statement;

        const deep: string[] = [];
        const residual: string[] = [];

        for (const raw of body.split(',')) {
          const entry = raw.trim();
          if (!entry) continue;

          const parsed = entry.match(/^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (!parsed) {
            residual.push(entry);
            continue;
          }

          const [, specifierIsType, imported, alias] = parsed;
          const target = specifierIsType ? undefined : icons!.get(imported);
          if (!target) {
            if (!specifierIsType) unresolved.add(imported);
            residual.push(entry);
            continue;
          }

          deep.push(`import ${alias ?? imported} from '${target}';`);
        }

        if (deep.length === 0) return statement;
        changed = true;
        if (residual.length > 0) {
          deep.push(`import { ${residual.join(', ')} } from 'lucide-react';`);
        }
        return deep.join('');
      });

      if (!changed) return null;
      return { code: next, map: null };
    },
    buildEnd() {
      if (unresolved.size > 0) {
        this.warn(
          `lucide-react names kept on the barrel import: ${[...unresolved].sort().join(', ')}`,
        );
      }
    },
  };
}

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        lucideIconImports(),
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['index.css'],
          manifest: {
            name: 'PRODIGI',
            short_name: 'PRODIGI',
            description: 'Garment production execution',
            theme_color: '#ffffff',
            background_color: '#f8fafc',
            display: 'standalone',
            start_url: '/',
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            navigateFallback: 'index.html',
            runtimeCaching: [],
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        reportCompressedSize: false,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/recharts')) return 'charts';
              if (id.includes('node_modules/@supabase')) return 'supabase';
              if (id.includes('node_modules/date-fns')) return 'dates';
              if (id.includes('node_modules')) return 'vendor';
            },
          },
        },
      },
      test: {
        globals: false,
        environment: 'node',
        include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts', 'modules/**/*.test.ts'],
      },
    };
});
