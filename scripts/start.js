'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || '127.0.0.1';
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.pmtiles': 'application/octet-stream' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); } catch { response.writeHead(400); return response.end('Bad request'); }
  let file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403); return response.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end('Not found'); }
  const stat = fs.statSync(file);
  const range = request.headers.range;
  if (range) {
    const match = range.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return response.end(); }
    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : stat.size - 1, stat.size - 1);
    if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return response.end(); }
    response.writeHead(206, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(response);
  }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(response);
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Cannot start Shasta Land Atlas: http://${host}:${port} is already in use.`);
    console.error(`Stop the existing server or run PORT=${port + 1} npm start`);
    process.exit(1);
  }
  throw error;
});
server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`Shasta Land Atlas is running at ${url}`);
  if (process.env.BROWSER !== 'none') exec(process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`, () => {});
});
