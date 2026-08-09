/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, 'public');
const targetDir = path.join(__dirname, 'dist', 'src', 'public');

const copyRecursive = (sourcePath, targetPath) => {
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    fs.mkdirSync(targetPath, {recursive: true});
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  fs.copyFileSync(sourcePath, targetPath);
};

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Source public directory not found: ${sourceDir}`);
}

/*
 * Clear the target first.
 *
 * Vite emits content-hashed filenames, so every rebuild produces new names
 * while the old ones stay behind. Copying without clearing had accumulated 276
 * files in dist against 21 actually in use — all of it dead weight that then
 * gets baked into the packaged binaries.
 */
fs.rmSync(targetDir, {recursive: true, force: true});

copyRecursive(sourceDir, targetDir);
console.log(`Synced public assets to ${targetDir}`);
