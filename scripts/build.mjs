import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vendorDir = path.join(root, 'public', 'vendor');

fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(
  path.join(root, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'),
  path.join(vendorDir, 'html5-qrcode.min.js')
);
console.log('Prepared local QR scanner library.');
