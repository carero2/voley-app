// El service worker no puede quedar vacío ni con archivos que no existen: node tests/sw.test.mjs
import fs from 'fs';
import { VERSION } from '../js/version.js';

const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
let fail = 0;
const check = (name, cond) => { if (!cond) { fail++; console.log('✗', name); } };
check('sw.js no está vacío', sw.length > 500 && sw.includes("addEventListener('fetch'"));
check('misma versión en sw.js y js/version.js', sw.includes(`const VERSION = '${VERSION}'`));
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
for (const a of assets) check(`existe ${a}`, fs.existsSync(new URL(`../${a}`, import.meta.url)));
const js = fs.readdirSync(new URL('../js', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'));
for (const f of js) check(`sw.js guarda js/${f}`, assets.includes(`js/${f}`));
console.log(fail ? `${fail} fallos` : `sw.js correcto (versión ${VERSION}, ${assets.length} archivos)`);
if (fail) process.exit(1);
