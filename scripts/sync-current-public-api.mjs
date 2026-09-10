import fs from 'node:fs';
import path from 'node:path';

const repo = process.env.XPSCRIPT_REPO_PATH || process.argv[2] || path.resolve('xpscript-source');
const outFile = path.resolve('src/generated/apiCatalog.ts');
if (!fs.existsSync(path.join(repo, 'docs')) || !fs.existsSync(outFile)) {
  console.log('XPscript source checkout not found, skipping current public API sync.');
  process.exit(0);
}

const source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
if (jsonEnd <= jsonStart) throw new Error('apiCatalog terminator not found');

const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const byKey = new Map(items.map(item => [item.qualifiedName.toLowerCase(), item]));
const add = item => {
  const key = item.qualifiedName.toLowerCase();
  const existing = byKey.get(key);
  byKey.set(key, existing ? { ...existing, ...item, description: item.description || existing.description, source: item.source || existing.source } : item);
};
const addIfMissing = item => {
  const key = item.qualifiedName.toLowerCase();
  if (!byKey.has(key)) byKey.set(key, item);
};

const cleanCell = value => value.trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|');
const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanCell);
const memberName = raw => raw.replace(/^`|`$/g, '').replace(/\(.*$/, '').trim();
const typeName = raw => {
  const tick = raw.match(/`([A-Za-z_]\w*)`/);
  if (tick) return tick[1];
  const plain = raw.match(/\b(Notes[A-Za-z0-9_]+|XP[A-Za-z0-9_]+|String|Integer|Long|Double|Boolean|Variant)\b/);
  return plain?.[1];
};
const parameterText = raw => {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 0 || close <= open) return '';
  return raw.slice(open + 1, close).replace(/[\[\]]/g, '').trim().replace(/\s*,\s*/g, '; ');
};

function syncNotesReference() {
  const file = path.join(repo, 'docs', 'notes-c-api.md');
  if (!fs.existsSync(file)) return 0;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let owner = '';
  let subsection = '';
  let added = 0;

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^##\s+(Notes[A-Za-z0-9_]+)/);
    if (heading) {
      owner = heading[1];
      subsection = '';
      addIfMissing({ name: owner, qualifiedName: owner, kind: 'class', syntax: `Dim value As ${owner}`, parameters: '', description: `Public XPscript ${owner} object.`, source: 'docs/notes-c-api.md', section: owner });
      continue;
    }
    const sub = lines[i].match(/^###\s+(.+)/);
    if (sub) subsection = sub[1].trim();
    if (!owner || !lines[i].trim().startsWith('|') || i + 1 >= lines.length) continue;
    const headers = splitRow(lines[i]).map(x => x.toLowerCase());
    if (!/^\|?\s*[-:]+/.test(lines[i + 1])) continue;

    const propertyIdx = headers.indexOf('property');
    const memberIdx = headers.indexOf('member');
    const typeIdx = headers.indexOf('type');
    const returnIdx = headers.indexOf('return type');
    const accessIdx = headers.indexOf('access');
    const descriptionIdx = headers.indexOf('description');
    if (propertyIdx < 0 && memberIdx < 0) continue;

    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const cells = splitRow(lines[i]);
      if (propertyIdx >= 0) {
        const name = memberName(cells[propertyIdx] || '');
        if (!name) continue;
        if (!/^[A-Za-z_]\w*$/.test(name))
          throw new Error(`docs/notes-c-api.md:${i + 1}: property rows must contain exactly one public member name; got "${cells[propertyIdx]}".`);
        const returnType = typeName(cells[typeIdx] || '');
        const writable = /read\/write|read-write/i.test(cells[accessIdx] || '');
        add({
          name,
          qualifiedName: `${owner}.${name}`,
          owner,
          kind: 'property',
          syntax: `${owner}.${name}`,
          parameters: '',
          description: cells[descriptionIdx] || `${owner}.${name}.`,
          ...(returnType ? { returnType } : {}),
          ...(writable ? { writable: true } : {}),
          source: 'docs/notes-c-api.md',
          section: subsection || owner
        });
        added++;
      } else {
        const raw = cells[memberIdx] || '';
        const name = memberName(raw);
        if (!name) continue;
        if (!/^[A-Za-z_]\w*$/.test(name))
          throw new Error(`docs/notes-c-api.md:${i + 1}: method rows must contain exactly one public member name; got "${raw}".`);
        const returnType = typeName(cells[returnIdx] || '');
        add({
          name,
          qualifiedName: `${owner}.${name}`,
          owner,
          kind: 'function',
          syntax: `${owner}.${raw.replace(/`/g, '')}`,
          parameters: parameterText(raw),
          description: cells[descriptionIdx] || `${owner}.${name}.`,
          ...(returnType && returnType !== 'Void' ? { returnType } : {}),
          source: 'docs/notes-c-api.md',
          section: subsection || owner
        });
        added++;
      }
    }
    i--;
  }
  return added;
}

function syncNotesSamples() {
  const sampleNames = [
    'notes-database-full-surface-test.xps',
    'notes-c-api-surface.xps',
    'notes-extended-surface.xps',
    'notes-richtext-linked-objects-surface.xps',
    'notes-richtext-mime-surface.xps',
    'notes-note-collection-surface.xps',
    'notes-dxl-import-export-surface.xps'
  ];
  let added = 0;
  for (const sampleName of sampleNames) {
    const file = path.join(repo, 'samples', sampleName);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const types = new Map();
    for (const match of text.matchAll(/\bDim\s+([A-Za-z_]\w*)\s+As\s+(?:New\s+)?(Notes[A-Za-z0-9_]+)/gi)) types.set(match[1].toLowerCase(), match[2]);
    for (const match of text.matchAll(/\b(?:ByVal|ByRef)\s+([A-Za-z_]\w*)\s+As\s+(Notes[A-Za-z0-9_]+)/gi)) types.set(match[1].toLowerCase(), match[2]);

    for (const [variable, owner] of types) {
      const fnRe = new RegExp(`\\b${variable}\\.([A-Za-z_]\\w*)\\s*\\(`, 'gi');
      for (const match of text.matchAll(fnRe)) {
        const name = match[1];
        const key = `${owner}.${name}`.toLowerCase();
        if (byKey.has(key)) continue;
        addIfMissing({ name, qualifiedName: `${owner}.${name}`, owner, kind: 'function', syntax: `${owner}.${name}(...)`, parameters: '', description: `Public ${owner}.${name} member verified by ${sampleName}.`, source: `samples/${sampleName}`, section: 'Public Notes full-surface sample' });
        added++;
      }
      const propRe = new RegExp(`\\b${variable}\\.([A-Za-z_]\\w*)`, 'gi');
      for (const match of text.matchAll(propRe)) {
        const name = match[1];
        const key = `${owner}.${name}`.toLowerCase();
        if (byKey.has(key)) continue;
        addIfMissing({ name, qualifiedName: `${owner}.${name}`, owner, kind: 'property', syntax: `${owner}.${name}`, parameters: '', description: `Public ${owner}.${name} property verified by ${sampleName}.`, source: `samples/${sampleName}`, section: 'Public Notes full-surface sample' });
        added++;
      }
    }
  }
  return added;
}

function syncNotesConst() {
  const file = path.join(repo, 'src', 'XPScript.Compiler', 'NotesConstPostProcessor.cs');
  if (!fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('Adds the XPscript NotesConst static constant surface')) return 0;
  addIfMissing({ name: 'NotesConst', qualifiedName: 'NotesConst', kind: 'class', syntax: 'NotesConst.Member', parameters: '', description: 'Static Notes/Domino constants exposed by XPscript.', source: 'src/XPScript.Compiler/NotesConstPostProcessor.cs', section: 'NotesConst public static surface' });
  const friendlyBlocks = [...text.matchAll(/\/\/ Friendly aliases[^\n]*\n([\s\S]*?)(?=\n\s*\/\/|\n})/g)];
  let added = 0;
  for (const block of friendlyBlocks) {
    for (const match of block[1].matchAll(/public const int\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
      const name = match[1];
      add({ name, qualifiedName: `NotesConst.${name}`, owner: 'NotesConst', kind: 'property', syntax: `NotesConst.${name}`, parameters: '', description: `Public NotesConst.${name} constant.`, returnType: 'Integer', source: 'src/XPScript.Compiler/NotesConstPostProcessor.cs', section: 'Friendly aliases for normal NotesConst.Member usage' });
      added++;
    }
  }
  return added;
}

const notesReference = syncNotesReference();
const notesSamples = syncNotesSamples();
const notesConstants = syncNotesConst();

const catalog = [...byKey.values()].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Synced current public API: ${notesReference} Notes reference rows, ${notesSamples} sample-only Notes members, ${notesConstants} NotesConst aliases. Catalog contains ${catalog.length} items.`);
if (notesReference === 0) throw new Error('docs/notes-c-api.md produced no IntelliSense entries; refusing to build a stale Notes catalog.');
