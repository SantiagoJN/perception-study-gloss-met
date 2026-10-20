import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(projectRoot, 'dist');
const index = join(dist, 'index.html');

for (const route of ['preview', 'testing', 'inhouse', 'test1_pair_comparison', 'test2_2afc', 'test3_matching', 'test4_mm']) {
  const routeDirectory = join(dist, route);
  mkdirSync(routeDirectory, { recursive: true });
  copyFileSync(index, join(routeDirectory, 'index.html'));
}
