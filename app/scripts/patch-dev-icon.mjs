// Gives the development build a Marmot icon and name.
//
// In development the app runs from node_modules/electron/dist/Electron.app, so
// macOS shows the Electron default icon in the Dock and the menu bar. The
// Dock image comes from the bundle's CFBundleIconFile, not from the
// BrowserWindow "icon" option — that one only affects the window.
//
// This script copies our icon over the bundle's and renames the bundle fields,
// so `npm start` looks like the packaged app. It is idempotent: it skips the
// work when the icon is already in place.
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const APP_NAME = 'Marmot';
const BUNDLE_ID = 'dev.marmot.editor';
const ICON_NAME = 'marmot.icns';

function main() {
  let electronBinary;
  try {
    electronBinary = require('electron');
  } catch {
    console.log('[marmot] electron is not installed; skipping the icon patch.');
    return;
  }
  if (typeof electronBinary !== 'string') {
    console.log('[marmot] electron does not expose a binary path; skipping.');
    return;
  }

  // electronBinary points at .../Electron.app/Contents/MacOS/Electron
  const bundle = dirname(dirname(dirname(electronBinary)));
  const resources = join(bundle, 'Contents', 'Resources');
  const plistPath = join(bundle, 'Contents', 'Info.plist');
  const targetIcon = join(resources, ICON_NAME);
  const sourceIcon = join(projectRoot, 'assets', ICON_NAME);

  if (!existsSync(plistPath) || !existsSync(sourceIcon)) {
    console.log('[marmot] nothing to patch.');
    return;
  }

  // 1. The icon itself.
  let alreadyPatched = false;
  try {
    alreadyPatched = readFileSync(targetIcon).equals(readFileSync(sourceIcon));
  } catch {
    alreadyPatched = false;
  }
  if (!alreadyPatched) {
    copyFileSync(sourceIcon, targetIcon);
  }

  // 2. The bundle metadata that points at it.
  const patchPlist = (key, value) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
        stdio: 'ignore',
      });
    } catch {
      try {
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', `Add :${key} string ${value}`, plistPath],
          { stdio: 'ignore' },
        );
      } catch {
        // Leave the default in place rather than failing the launch.
      }
    }
  };

  patchPlist('CFBundleIconFile', ICON_NAME);
  patchPlist('CFBundleName', APP_NAME);
  patchPlist('CFBundleDisplayName', APP_NAME);
  patchPlist('CFBundleIdentifier', BUNDLE_ID);

  console.log(`[marmot] development bundle icon and name set to ${APP_NAME}.`);
}

main();
