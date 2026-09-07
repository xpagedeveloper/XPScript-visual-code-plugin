import fs from 'node:fs';
import path from 'node:path';

const catalogPath = path.resolve('src/generated/apiCatalog.ts');
const removedNames = [
  'IsWebAgent',
  'IsActivatable',
  'ProhibitDesignUpdate',
  'Target',
  'HttpURL',
  'UnLock',
  'FTSearchScore'
];

let text = fs.readFileSync(catalogPath, 'utf8');
const before = text;
const lines = text.split(/\r?\n/);
text = lines
  .filter(line => !removedNames.some(name =>
    line.includes(`name:'${name}'`) ||
    line.includes(`name: '${name}'`) ||
    line.includes(`.${name}`)
  ))
  .join('\n');

if (before.endsWith('\n')) text += '\n';
fs.writeFileSync(catalogPath, text, 'utf8');

for (const name of removedNames) {
  if (new RegExp(`(?:name\\s*:\\s*['\"]${name}['\"]|\\.${name}\\b)`).test(text)) {
    throw new Error(`Removed XPscript API member still present in generated catalog: ${name}`);
  }
}

console.log('Removed unsupported Notes API members from generated IntelliSense catalog.');
