const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const icoPath = path.join(rootDir, 'electron', 'icon.ico');
const buildDir = path.join(rootDir, 'build');
const sourcePngPath = path.join(buildDir, 'icon-source.png');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const icnsPath = path.join(buildDir, 'icon.icns');

function readIcoEntries(buffer) {
  if (buffer.length < 6) throw new Error('ICO file is too small');
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (reserved !== 0 || type !== 1 || count < 1) {
    throw new Error('Invalid ICO header');
  }

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    const bitCount = buffer.readUInt16LE(offset + 6);
    const size = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    entries.push({ width, height, bitCount, size, imageOffset });
  }
  return entries;
}

function extractBestPngFromIco() {
  const buffer = fs.readFileSync(icoPath);
  const entries = readIcoEntries(buffer)
    .filter(entry => entry.imageOffset + entry.size <= buffer.length)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.bitCount - a.bitCount);

  for (const entry of entries) {
    const image = buffer.subarray(entry.imageOffset, entry.imageOffset + entry.size);
    const isPng = image.length > 8
      && image[0] === 0x89
      && image[1] === 0x50
      && image[2] === 0x4e
      && image[3] === 0x47;
    if (isPng) {
      fs.mkdirSync(buildDir, { recursive: true });
      fs.writeFileSync(sourcePngPath, image);
      console.log(`[Mac Icon] Extracted ${entry.width}x${entry.height} PNG from electron/icon.ico`);
      return;
    }
  }

  throw new Error('electron/icon.ico does not contain a PNG image entry; cannot generate macOS .icns automatically');
}

function resetIconset() {
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
}

function generateIconset() {
  const variants = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  for (const [name, size] of variants) {
    execFileSync('sips', ['-z', String(size), String(size), sourcePngPath, '--out', path.join(iconsetDir, name)], {
      stdio: 'inherit',
    });
  }

  fs.rmSync(icnsPath, { force: true });
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  console.log(`[Mac Icon] Wrote ${path.relative(rootDir, icnsPath)}`);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[Mac Icon] Skipped: .icns generation requires macOS sips/iconutil');
    return;
  }

  if (!fs.existsSync(icoPath)) {
    throw new Error(`Missing icon source: ${path.relative(rootDir, icoPath)}`);
  }

  extractBestPngFromIco();
  resetIconset();
  generateIconset();
}

main();
