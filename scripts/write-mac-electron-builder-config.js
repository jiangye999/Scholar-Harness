const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packagePath = path.join(rootDir, 'package.json');
const outputDir = path.join(rootDir, 'dist');
const outputPath = path.join(outputDir, 'electron-builder-mac.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const build = JSON.parse(JSON.stringify(packageJson.build || {}));

build.extraResources = (build.extraResources || []).filter((entry) => {
  const from = String(entry && entry.from ? entry.from : '');
  const to = String(entry && entry.to ? entry.to : '');
  return !from.startsWith('tools/ppt-master') && !to.startsWith('tools/ppt-master');
});

delete build.win;
delete build.nsis;

build.mac = {
  ...(build.mac || {}),
  icon: 'build/icon.icns',
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(build, null, 2));
console.log(`[Mac Build] Wrote ${path.relative(rootDir, outputPath)}`);
console.log('[Mac Build] Skipped extraResources: tools/ppt-master');
