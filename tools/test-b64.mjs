import fs from 'node:fs';
import * as D from '../js/data.js';
const txt = fs.readFileSync(new URL('../dist/credits.txt', import.meta.url), 'utf8');
const bin = atob(txt.trim());
const buf = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
D.parse(buf);
console.log('base64 round trip ok:', D.seedOf(11469), D.paidAtOf(122154), D.count());
