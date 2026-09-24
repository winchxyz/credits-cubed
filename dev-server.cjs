/* Credits³ — tiny static dev server (node dev-server.js [port])
   Serves the project with no caching. POST /__shot saves a canvas capture
   (JSON {name, data:dataURL}) to ./shots for inspection. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const port = Number(process.argv[2]) || 8880;
const shotDir = path.join(root, 'shots');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/__shot')) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const { name, data } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const safe = String(name || 'shot').replace(/[^a-z0-9_-]/gi, '_');
        fs.mkdirSync(shotDir, { recursive: true });
        const file = path.join(shotDir, safe + (/^data:image\/png/.test(data) ? '.png' : '.jpg'));
        fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, file }));
      } catch (e) { res.writeHead(400); res.end(String(e)); }
    });
    return;
  }
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log(`Credits³ -> http://localhost:${port}`));
