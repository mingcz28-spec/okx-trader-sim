import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'frontend', 'dist');
const target = path.join(root, 'out', 'wwwroot');

if (!fs.existsSync(source)) {
  throw new Error(`Frontend dist not found: ${source}`);
}

fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true, force: true });
console.log(`Copied ${source} -> ${target}`);
