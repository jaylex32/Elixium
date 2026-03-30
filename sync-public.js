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

copyRecursive(sourceDir, targetDir);
console.log(`Synced public assets to ${targetDir}`);
