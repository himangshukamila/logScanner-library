import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  NPM_CONFIG_CACHE: process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? join(process.platform === 'win32' ? tmpdir() : '/tmp', 'log-scanner-npm-cache'),
};

function run(command, args, cwd, capture = false) {
  console.log(`[package] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: false,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }
    throw new Error(`${command} failed (${result.signal ?? result.status}) in ${cwd}`);
  }
  return result.stdout;
}

function installedVersion(name) {
  return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

assert(existsSync(join(root, 'dist/index.js')), 'Run npm run build before verifying the package.');
const browserBundle = readFileSync(join(root, 'dist/index.js'), 'utf8');
assert(browserBundle.includes('#08EBD8'), 'The built bundle must contain the inline SVG logo mark.');
assert(!browserBundle.includes('data:image/'), 'The logo must be inline SVG markup, not an embedded data URL.');
mkdirSync(artifacts, { recursive: true });
const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts], root, true));
assert(packed?.filename && packed?.shasum, 'npm pack did not return a package archive.');
for (const required of ['dist/index.js', 'dist/node.js', 'dist/log-scanner.css', 'dist/types/index.d.ts']) {
  assert(packed.files.some(({ path }) => path === required), `Archive is missing ${required}`);
}
assert(!packed.files.some(({ path }) => path.startsWith('node_modules/')), 'Dependencies must not be bundled into the archive.');
assert(!packed.files.some(({ path }) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path)), 'The archive must ship no image files; the logo is inline SVG.');

// A content-specific dependency path prevents npm from reusing an older build of the same version.
const archive = join(artifacts, `${packed.filename.slice(0, -4)}-${packed.shasum.slice(0, 12)}.tgz`);
copyFileSync(join(artifacts, packed.filename), archive);
const variants = [
  { major: 18, react: '18.3.1', reactDom: '18.3.1', typesReact: '^18.3.0', typesReactDom: '^18.3.0' },
  {
    major: 19,
    react: installedVersion('react'),
    reactDom: installedVersion('react-dom'),
    typesReact: installedVersion('@types/react'),
    typesReactDom: installedVersion('@types/react-dom'),
  },
];
assert(variants[1].react.startsWith('19.'), 'The React 19 consumer requires React 19 installed at the package root.');

for (const variant of variants) {
  const consumer = join(artifacts, `consumer-react${variant.major}`);
  mkdirSync(consumer, { recursive: true });
  writeJson(join(consumer, 'package.json'), {
    name: `log-scanner-consumer-react${variant.major}`,
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      [manifest.name]: `file:${archive}`,
      react: variant.react,
      'react-dom': variant.reactDom,
    },
    devDependencies: {
      '@types/node': installedVersion('@types/node'),
      '@types/react': variant.typesReact,
      '@types/react-dom': variant.typesReactDom,
      typescript: installedVersion('typescript'),
      vite: installedVersion('vite'),
    },
  });
  writeFileSync(join(consumer, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Log Scanner package verification</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>\n');
  writeFileSync(join(consumer, 'main.tsx'), `import { createRoot } from 'react-dom/client';
import { LogScanner, installBrowserCapture, type LogScannerProps, type LogEntry } from ${JSON.stringify(manifest.name)};
import ${JSON.stringify(`${manifest.name}/styles.css`)};

const props: LogScannerProps = { enabled: true, maxLogs: 50, serverUrl: '/__log-scanner/events' };
const entrySource: LogEntry['source'] = 'browser';
const stop = installBrowserCapture();
stop();
const root = document.getElementById('root');
if (!root) throw new Error('Missing consumer root');
root.dataset.logSource = entrySource;
createRoot(root).render(<LogScanner {...props} />);
`);
  writeFileSync(join(consumer, 'node-consumer.ts'), `import { createNodeLogScanner, type NodeLogScannerOptions } from ${JSON.stringify(`${manifest.name}/node`)};
const options: NodeLogScannerOptions = { enabled: false, maxLogs: 100, allowedOrigins: ['http://localhost:5173'] };
const scanner = createNodeLogScanner(options);
scanner.dispose();
`);
  const compilerOptions = {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: ['node', 'react', 'react-dom', 'vite/client'],
  };
  writeJson(join(consumer, 'tsconfig.bundler.json'), {
    compilerOptions: { ...compilerOptions, module: 'ESNext', moduleResolution: 'Bundler' },
    include: ['main.tsx', 'node-consumer.ts'],
  });
  writeJson(join(consumer, 'tsconfig.json'), { extends: './tsconfig.bundler.json' });
  writeJson(join(consumer, 'tsconfig.nodenext.json'), {
    compilerOptions: { ...compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['main.tsx', 'node-consumer.ts'],
  });
  writeFileSync(join(consumer, 'verify.mjs'), `import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'vite';

const packageName = ${JSON.stringify(manifest.name)};
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const browserEntry = fileURLToPath(import.meta.resolve(packageName));
const nodeEntry = fileURLToPath(import.meta.resolve(packageName + '/node'));
const normalizeModuleId = id => id.replaceAll('\\\\', '/').split('?')[0];
const browserModuleId = normalizeModuleId(realpathSync(browserEntry));
const nodeModuleId = normalizeModuleId(realpathSync(nodeEntry));
assert(readFileSync(browserEntry, 'utf8').includes('#08EBD8'), 'The installed package must contain the inline SVG logo mark.');
const packageRequire = createRequire(browserEntry);
const reactPath = realpathSync(require.resolve('react'));
assert.equal(realpathSync(packageRequire.resolve('react')), reactPath, 'Log Scanner must use the consumer React instance.');
assert.equal(realpathSync(createRequire(packageRequire.resolve('react-error-boundary')).resolve('react')), reactPath, 'The error boundary must share the consumer React instance.');
assert.equal(realpathSync(packageRequire.resolve('react-dom')), realpathSync(require.resolve('react-dom')), 'Log Scanner must use the consumer React DOM instance.');
const levels = ['log', 'info', 'warn', 'error', 'debug'];
const originals = new Map(levels.map(level => [level, console[level]]));
const { LogScanner, installBrowserCapture } = await import(packageName);
const unchangedConsole = () => {
  for (const [level, original] of originals) assert.equal(console[level], original, level + ' was unexpectedly patched');
};
unchangedConsole();
for (const enabled of [false, true]) {
  assert.equal(renderToString(React.createElement(LogScanner, { enabled, serverUrl: '/__log-scanner/events' })), '');
  unchangedConsole();
}
const stop = installBrowserCapture();
unchangedConsole();
stop();
const { createNodeLogScanner } = await import(packageName + '/node');
unchangedConsole();
const disabled = createNodeLogScanner();
unchangedConsole();
disabled.dispose();
const originalEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
const production = createNodeLogScanner({ enabled: true });
unchangedConsole();
production.dispose();
if (originalEnvironment === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalEnvironment;

const installedManifest = JSON.parse(readFileSync(packageRequire.resolve(packageName + '/package.json'), 'utf8'));
assert(!installedManifest.dependencies?.react, 'React belongs in peerDependencies.');
assert(!installedManifest.dependencies?.['react-dom'], 'React DOM belongs in peerDependencies.');
for (const dependency of ['tailwindcss', '@tailwindcss/vite']) {
  assert(!existsSync(join(root, 'node_modules', dependency)), dependency + ' must not be installed in the consumer.');
}
const sourceMap = JSON.parse(readFileSync(browserEntry + '.map', 'utf8'));
assert(!sourceMap.sources.some(source => /node_modules\\/(react|react-dom)\\//.test(source)), 'The published browser bundle must keep React external.');

const nativeModules = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
let modules = [];
let imageAssets = [];
await build({
  root,
  configFile: false,
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [{
    name: 'audit-log-scanner-consumer',
    generateBundle(_options, bundle) {
      modules = Array.from(this.getModuleIds());
      imageAssets = Object.values(bundle).filter(output => output.type === 'asset' && /\\.(png|jpe?g|gif|webp|svg)$/i.test(output.fileName)).map(output => output.fileName);
      this.emitFile({ type: 'asset', fileName: 'module-graph.json', source: JSON.stringify(modules, null, 2) });
    },
  }],
});
assert.deepEqual(imageAssets, [], 'The consumer build must emit no image assets for the inline logo.');
assert(modules.some(id => normalizeModuleId(id) === browserModuleId), 'The consumer must actually bundle Log Scanner.');
assert(!modules.some(id => nativeModules.has(id) || id.includes('__vite-browser-external') || normalizeModuleId(id) === nodeModuleId), 'Node modules leaked into the browser module graph.');
const reactRoots = new Set(modules.map(id => id.replaceAll('\\\\', '/').match(/^(.*\\/node_modules\\/react)\\//)?.[1]).filter(Boolean));
assert.equal(reactRoots.size, 1, 'The browser build must contain one React installation.');
console.log('[package] React ' + React.version + ': SSR, disabled capture, Node production guard, single React instance, and browser graph passed.');
`);

  console.log(`[package] Verifying isolated React ${variant.react} consumer`);
  run(npm, ['install', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'], consumer);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.bundler.json'], consumer);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.nodenext.json'], consumer);
  run(npm, ['ls', 'react', 'react-dom', '--all'], consumer);
  run(process.execPath, ['verify.mjs'], consumer);
}

console.log(`[package] Both packed consumers passed. Inspect fixtures and archives in ${artifacts}`);
