import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const pluginDirectory = resolve(process.argv[2] || 'plugins/citations');
const manifestPath = join(pluginDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.id || !manifest.entry || !manifest.entry.startsWith('dist/')) throw new Error('Plugin manifest must point to a dist entry.');

const temporaryDirectory = join(pluginDirectory, '.build');
const entryOutput = join(temporaryDirectory, basename(manifest.entry));
await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(temporaryDirectory, { recursive: true });
await build({ entryPoints: [join(pluginDirectory, 'src/index.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: entryOutput, sourcemap: false });

const manifestBytes = await readFile(manifestPath);
const entryBytes = await readFile(entryOutput);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrityBytes = strToU8(JSON.stringify({ 'manifest.json': hash(manifestBytes), [manifest.entry]: hash(entryBytes) }, null, 2));
const readmeBytes = await readFile(join(pluginDirectory, 'README.md'));
const archive = zipSync({ 'manifest.json': manifestBytes, [manifest.entry]: entryBytes, 'integrity.json': integrityBytes, 'README.md': readmeBytes });
const outputPath = join(pluginDirectory, 'dist', `${manifest.id}.markit-plugin`);
await mkdir(join(pluginDirectory, 'dist'), { recursive: true });
await writeFile(outputPath, archive);
await rm(temporaryDirectory, { recursive: true, force: true });
console.log(outputPath);
