'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(build, { recursive: true });
for (const entry of ['index.html', 'assets', 'data']) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) throw new Error(`Required source is missing: ${entry}`);
  fs.cpSync(source, path.join(build, entry), { recursive: true });
}
const publicDirectory = path.join(root, 'public');
if (fs.existsSync(publicDirectory)) fs.cpSync(publicDirectory, build, { recursive: true });
fs.writeFileSync(path.join(build, '.nojekyll'), '');
console.log('Built GitHub Pages site in build/');
