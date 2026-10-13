import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve('dist');

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    else if (relativePath !== 'sw.js') files.push(relativePath);
  }

  return files.sort();
}

const files = await listFiles(outputDirectory);
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(path.join(outputDirectory, file)));

const cacheName = `cet6-editorial-${hash.digest('hex').slice(0, 12)}`;
const cachedUrls = ['./', ...files.map(file => `./${file}`)];

const serviceWorker = `const CACHE = ${JSON.stringify(cacheName)};
const APP_FILES = ${JSON.stringify(cachedUrls, null, 2)};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
`;

await writeFile(path.join(outputDirectory, 'sw.js'), serviceWorker);
console.log(`Generated offline cache ${cacheName} with ${cachedUrls.length} files.`);
