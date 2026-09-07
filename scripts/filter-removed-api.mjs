import fs from 'node:fs';

const outFile = 'src/generated/apiCatalog.ts';
const source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
if (jsonEnd <= jsonStart) throw new Error('apiCatalog terminator not found');

const removedNames = new Set([
  'iswebagent',
  'isactivatable',
  'prohibitdesignupdate',
  'target',
  'httpurl',
  'unlock',
  'ftsearchscore'
]);

const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const filtered = items.filter(item => !removedNames.has(String(item.name ?? '').toLowerCase()));

for (const item of filtered) {
  if (removedNames.has(String(item.name ?? '').toLowerCase())) {
    throw new Error(`Removed XPscript API member still present in generated catalog: ${item.qualifiedName ?? item.name}`);
  }
}

const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(filtered, null, 2)};\n`);
console.log(`Removed ${items.length - filtered.length} unsupported Notes API entries from generated IntelliSense catalog.`);
