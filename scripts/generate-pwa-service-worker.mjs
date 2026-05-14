import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const serviceWorkerFileName = 'service-worker.js';
const serviceWorkerPath = path.join(distDir, serviceWorkerFileName);

const toPosixPath = (value) => value.split(path.sep).join('/');

const shouldPrecache = (relativePath) => {
  if (relativePath === serviceWorkerFileName) return false;
  if (relativePath === '_redirects' || relativePath === '_headers') return false;
  if (relativePath.endsWith('.map')) return false;
  return true;
};

const walkDistFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkDistFiles(fullPath);
      if (!entry.isFile()) return [];
      const relativePath = toPosixPath(path.relative(distDir, fullPath));
      return shouldPrecache(relativePath) ? [relativePath] : [];
    }),
  );
  return files.flat();
};

const buildCacheVersion = async (files) => {
  const hash = createHash('sha256');
  for (const file of files) {
    const fullPath = path.join(distDir, file);
    const fileStat = await stat(fullPath);
    const content = await readFile(fullPath);
    hash.update(file);
    hash.update(String(fileStat.size));
    hash.update(content);
  }
  return hash.digest('hex').slice(0, 16);
};

const createServiceWorkerSource = ({ cacheName, files }) => `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_FILES = ${JSON.stringify(files, null, 2)};
const APP_SHELL_FILE = 'index.html';

const toScopeUrl = (file) => new URL(file, self.registration.scope).toString();

const getPrecacheUrls = () => ['', ...PRECACHE_FILES].map(toScopeUrl);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(getPrecacheUrls()))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const getCachedAppShell = async () => {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(toScopeUrl(''))) || (await cache.match(toScopeUrl(APP_SHELL_FILE)));
};

const handleNavigationRequest = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(toScopeUrl(''), response.clone());
      return response;
    }

    return (await getCachedAppShell()) || response;
  } catch {
    const cachedPage = await caches.match(request);
    return cachedPage || (await getCachedAppShell());
  }
};

const handleSameOriginRequest = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleSameOriginRequest(request));
});
`;

const files = (await walkDistFiles(distDir)).sort();
const cacheVersion = await buildCacheVersion(files);

await writeFile(
  serviceWorkerPath,
  createServiceWorkerSource({
    cacheName: `weread-precache-${cacheVersion}`,
    files,
  }),
  'utf8',
);

console.log(`Generated ${serviceWorkerFileName} with ${files.length} precached files.`);
