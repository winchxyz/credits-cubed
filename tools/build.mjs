// node tools/build.mjs
// The project root is already the static site (open index.html through any static server).
// This writes the claude.ai Artifact version: dist/artifact.html is the page without its
// html/head/body wrapper, and dist/artifact-files.json maps every file published beside it.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const keep = (head.match(/<title>[\s\S]*?<\/title>|<meta name="(?:description|credits-data)"[^>]*>|<link [^>]*>/g) || []).filter(t => !/rel="icon"/.test(t));
const strip = s => s.replace(/((?:src|href)="(?:css|js)\/[^"?]+)\?v=\d+"/g, '$1"');
// Artifacts serve text, not .bin: the data ships as base64 and the page is pointed at it.
const page = strip(keep.join('\n') + '\n' + body.trim() + '\n').replace('content="data/credits.bin"', 'content="data/credits.txt"');

const files = { 'css/style.css': 'css/style.css' };
for (const f of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) files['js/' + f] = 'js/' + f;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'credits.txt'), fs.readFileSync(path.join(root, 'data', 'credits.bin')).toString('base64'));
files['data/credits.txt'] = 'dist/credits.txt';

// every relative import in the modules must be published
for (const f of Object.keys(files).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(/from '\.\/([^']+)'/g)) if (!files['js/' + m[1]]) throw new Error(`${f} imports ${m[1]}, which is not published`);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), page);
fs.writeFileSync(path.join(root, 'dist', 'artifact-files.json'), JSON.stringify(files, null, 2) + '\n');
// dist/preview/: the fragment in a skeleton with a CSP like the Artifact viewer's, files at their published paths
const preview = path.join(root, 'dist', 'preview');
fs.rmSync(preview, { recursive: true, force: true });
for (const [pub, src] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(preview, pub)), { recursive: true });
  fs.copyFileSync(path.join(root, typeof src === 'string' ? src : src.from), path.join(preview, pub));
}
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'";
fs.writeFileSync(path.join(preview, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>\n${page}</body></html>\n`);
const bytes = Object.values(files).reduce((n, v) => n + fs.statSync(path.join(root, typeof v === 'string' ? v : v.from)).size, 0);
console.log(`dist/artifact.html ${page.length} B · ${Object.keys(files).length} files · ${(bytes / 1e6).toFixed(2)} MB`);
