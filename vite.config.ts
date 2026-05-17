import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const normalizeBase = (value: string | undefined): string => {
  if (!value || value === '/') return '/';
  const normalized = value.trim();
  if (!normalized || normalized === '/') return '/';
  return `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
};

export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE_PATH),
  plugins: [react()],
  build: {
    target: 'esnext',
    // Split vendor code into stable chunks so user code changes do not bust
    // the long-cached library bundles. Keep heavy / optional libs (flexsearch,
    // jschardet, lit) in their own chunks so they download lazily with the
    // routes that need them.
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('/react-dom/') || id.includes('\\react-dom\\')) return 'vendor-react';
          if (id.includes('/react/') || id.includes('\\react\\')) return 'vendor-react';
          if (id.includes('scheduler')) return 'vendor-react';
          if (id.includes('flexsearch')) return 'vendor-flexsearch';
          if (id.includes('jschardet')) return 'vendor-jschardet';
          if (id.includes('lit') || id.includes('@khmyznikov/pwa-install')) return 'vendor-pwa';
          if (id.includes('ranui') || id.includes('ranuts')) return 'vendor-ranui';
          return 'vendor';
        },
      },
    },
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@/components': resolve(__dirname, 'components'),
      '@/router': resolve(__dirname, 'router'),
      '@/lib': resolve(__dirname, 'lib'),
      '@/store': resolve(__dirname, 'store'),
      '@/assets': resolve(__dirname, 'assets'),
      '@/types': resolve(__dirname, 'types'),
      '@/styles': resolve(__dirname, 'styles'),
      '@/pages': resolve(__dirname, 'pages'),
      '@/locales': resolve(__dirname, 'locales'),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/base.css";`,
      },
    },
  },
});
