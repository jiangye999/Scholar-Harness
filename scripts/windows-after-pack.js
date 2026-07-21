const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function toWindowsVersion(value) {
  const parts = String(value || '0.0.0')
    .split('.')
    .map((part) => String(Number.parseInt(part, 10) || 0))
    .slice(0, 4);
  while (parts.length < 4) parts.push('0');
  return parts.join('.');
}

async function runRcedit(rceditPath, executablePath, args) {
  await execFileAsync(rceditPath, [executablePath, ...args], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

exports.default = async function configureWindowsExecutable(context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectRoot = path.resolve(__dirname, '..');
  const rceditPath = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const iconPath = path.join(projectRoot, 'electron', 'icon.ico');
  const appInfo = context.packager.appInfo;
  const executablePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);

  for (const requiredPath of [rceditPath, iconPath, executablePath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Windows resource editor input is missing: ${requiredPath}`);
    }
  }

  const version = toWindowsVersion(appInfo.version);
  const metadata = {
    FileDescription: appInfo.productName,
    ProductName: appInfo.productName,
    CompanyName: appInfo.companyName || 'sjs@cau.edu.cn',
    LegalCopyright: appInfo.copyright || `Copyright © ${new Date().getFullYear()} sjs@cau.edu.cn`,
    OriginalFilename: `${appInfo.productFilename}.exe`,
    InternalName: appInfo.productFilename,
  };

  // electron-winstaller bundles rcedit 0.2, which accepts one mutation per
  // invocation. Running deterministic local mutations avoids electron-builder's
  // legacy winCodeSign archive and its macOS symlink extraction failure on Windows.
  for (const [key, value] of Object.entries(metadata)) {
    await runRcedit(rceditPath, executablePath, ['--set-version-string', key, String(value)]);
  }
  await runRcedit(rceditPath, executablePath, ['--set-file-version', version]);
  await runRcedit(rceditPath, executablePath, ['--set-product-version', version]);
  await runRcedit(rceditPath, executablePath, ['--set-icon', iconPath]);

  console.log(`[Windows AfterPack] Applied icon and version ${version} to ${executablePath}`);
};
