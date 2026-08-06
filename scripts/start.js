'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); } catch { response.writeHead(400); return response.end('Bad request'); }
  let file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403); return response.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end('Not found'); }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`Shasta Land Atlas is running at ${url}`);
  if (process.env.BROWSER !== 'none') exec(process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`, () => {});
});
