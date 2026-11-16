// Builds the shareable bundle: release/wardrobe.tar.gz (one archive for macOS and Windows).
// It contains app/ with the server, adapter, launcher, built UI, icons and every runtime dependency
// (including OpenCLI and sharp's macOS + Windows binaries), so installs never run npm.
//   node scripts/build-release.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'release');
const STAGE = path.join(OUT, 'stage');
const APP = path.join(STAGE, 'app');
const OPENCLI_VERSION = '2.0.2'; // the version the try-on adapter is tested against
// Platforms the installers support: macOS (Apple Silicon + Intel) and Windows x64 (also runs on ARM PCs).
const SHARP_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
const npm = (args, cwd) => run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// 1. UI
npm(['--prefix', 'web', 'run', 'build']);

// 2. App files
for (const p of ['server', 'adapters', 'launcher.js']) fs.cpSync(path.join(ROOT, p), path.join(APP, p), { recursive: true });
fs.cpSync(path.join(ROOT, 'web', 'dist'), path.join(APP, 'web', 'dist'), { recursive: true });

// 3. package.json with the pinned OpenCLI, then production dependencies (no install scripts:
//    OpenCLI's postinstall only writes shell completions; sharp ships prebuilt binaries).
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const sharpVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'sharp', 'package.json'), 'utf8')).version;
const deps = { ...pkg.dependencies, sharp: sharpVersion, '@jackwener/opencli': OPENCLI_VERSION };
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: 'wardrobe', private: true, type: 'module', dependencies: deps }, null, 2));
npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], APP);

// 4. sharp binaries for every supported platform (npm only installs the build machine's own).
const sharpPkg = JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', 'sharp', 'package.json'), 'utf8'));
const extra = SHARP_PLATFORMS.flatMap((plat) => [`@img/sharp-${plat}`, `@img/sharp-libvips-${plat}`])
  .filter((name) => sharpPkg.optionalDependencies[name])
  .map((name) => `${name}@${sharpPkg.optionalDependencies[name]}`);
npm(['install', '--no-save', '--force', '--ignore-scripts', '--no-audit', '--no-fund', ...extra], APP);
for (const name of fs.readdirSync(path.join(APP, 'node_modules', '@img'))) {
  const keep = name === 'colour' || SHARP_PLATFORMS.some((plat) => name.endsWith(plat));
  if (!keep) fs.rmSync(path.join(APP, 'node_modules', '@img', name), { recursive: true, force: true });
}
for (const plat of SHARP_PLATFORMS) {
  if (!fs.existsSync(path.join(APP, 'node_modules', '@img', `sharp-${plat}`))) throw new Error(`sharp binary missing for ${plat}`);
}

// 5. No symlinks: Windows can't extract them without admin rights. .bin holds only shims we never use.
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fs.rmSync(p, { force: true });
    else if (e.isDirectory()) { if (e.name === '.bin') fs.rmSync(p, { recursive: true, force: true }); else walk(p); }
  }
};
walk(APP);

// 6. Icons: PNG-in-ICO for Windows shortcuts, ICNS for the macOS app.
const svg = fs.readFileSync(path.join(ROOT, 'web', 'public', 'favicon.svg'));
const png = (size) => sharp(svg, { density: 72 * (size / 32) }).resize(size, size).png().toBuffer();
const ico = async () => {
  const sizes = [16, 32, 48, 256];
  const imgs = await Promise.all(sizes.map(png));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
};
const icns = async () => {
  const types = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
  const chunks = await Promise.all(types.map(async ([t, s]) => {
    const data = await png(s);
    const h = Buffer.alloc(8); h.write(t, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  }));
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
};
fs.mkdirSync(path.join(APP, 'icons'), { recursive: true });
fs.writeFileSync(path.join(APP, 'icons', 'wardrobe.ico'), await ico());
fs.writeFileSync(path.join(APP, 'icons', 'wardrobe.icns'), await icns());

// 7. Version stamp and archive (tar.gz: macOS tar and Windows' built-in tar.exe both read it).
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim() ? '-dirty' : '';
const version = `${new Date().toISOString().slice(0, 10)}-${sha}${dirty}`;
fs.writeFileSync(path.join(APP, 'VERSION'), `${version}\n`);
run('tar', ['-czf', path.join(OUT, 'wardrobe.tar.gz'), '-C', STAGE, 'app']);
for (const f of ['install.sh', 'install.ps1']) fs.copyFileSync(path.join(ROOT, 'install', f), path.join(OUT, f));
const mb = (fs.statSync(path.join(OUT, 'wardrobe.tar.gz')).size / 1e6).toFixed(1);
console.log(`\nrelease/wardrobe.tar.gz  ${mb} MB  version ${version}`);
