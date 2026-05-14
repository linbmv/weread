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
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@/components/popover': resolve(__dirname, 'components/Popover/index.tsx'),
      '@/components/Popover': resolve(__dirname, 'components/Popover/index.tsx'),
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
