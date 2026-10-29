import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(projectRoot, 'dist');
const index = join(dist, 'index.html');
const deploymentVersion = (process.env.GITHUB_SHA || `local-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '');
const html = readFileSync(index, 'utf8').replaceAll('__DEPLOYMENT_VERSION__', deploymentVersion);
writeFileSync(index, html);

const participantRoutes = ['test1_pair_comparison', 'test2_2afc', 'test3_matching', 'test3.2_matching2', 'test4_mm'];
for (const route of ['preview', 'testing', 'inhouse', ...participantRoutes, ...participantRoutes.map((route) => `anon/${route}`)]) {
  const routeDirectory = join(dist, route);
  mkdirSync(routeDirectory, { recursive: true });
  copyFileSync(index, join(routeDirectory, 'index.html'));
}
