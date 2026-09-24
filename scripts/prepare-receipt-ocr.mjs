import { mkdir, copyFile, readdir } from 'node:fs/promises';
const dest = 'public/ocr/v7';
await mkdir(dest + '/core', { recursive: true });
await copyFile('node_modules/tesseract.js/dist/worker.min.js', dest + '/worker.min.js');
await copyFile(
  'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',
  dest + '/worker.LICENSE.txt',
);
await copyFile('node_modules/tesseract.js/LICENSE.md', dest + '/LICENSE');
await copyFile('node_modules/tesseract.js-core/LICENSE', dest + '/core/LICENSE');
for (const f of await readdir('node_modules/tesseract.js-core'))
  if (f.endsWith('.wasm.js'))
    await copyFile('node_modules/tesseract.js-core/' + f, dest + '/core/' + f);
console.log('Receipt OCR worker and device-compatible cores prepared.');
