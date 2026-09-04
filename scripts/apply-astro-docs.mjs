import fs from 'node:fs';
import path from 'node:path';

const docsRepo = process.env.XPSCRIPT_ASTRO_DOCS_PATH || process.argv[2];
const outFile = path.resolve('src/generated/apiCatalog.ts');

if (!docsRepo || !fs.existsSync(path.join(docsRepo, 'docs'))) {
  console.log('Astro docs checkout not found, keeping existing IntelliSense help metadata.');
  process.exit(0);
}
if (!fs.existsSync(outFile)) throw new Error(`Generated catalog not found: ${outFile}`);

const source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
if (jsonEnd <= jsonStart) throw new Error('apiCatalog terminator not found');

const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const byKey = new Map(items.map(item => [item.qualifiedName.toLowerCase(), item]));

// These APIs are explicitly removed on current XPscript main and must never be
// reintroduced by documentation that may temporarily lag the runtime/compiler.
const removed = new Set([
  'csvsave',
  'csvwritefile',
  'xpcsvdocument.writefile'
]);
for (const key of removed) byKey.delete(key);

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(full);
  }
  return result;
}

function scalar(raw) {
  const value = raw.trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^(null|~)$/i.test(value)) return null;
  return value;
}

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;

  const data = {};
  let currentArray = null;
  let currentItem = null;

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const top = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (top) {
      currentItem = null;
      const [, key, raw] = top;
      if (!raw.trim()) {
        data[key] = [];
        currentArray = key;
      } else {
        data[key] = scalar(raw);
        currentArray = null;
      }
      continue;
    }

    const arrayStart = line.match(/^\s{2}-\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (arrayStart && currentArray && Array.isArray(data[currentArray])) {
      currentItem = { [arrayStart[1]]: scalar(arrayStart[2]) };
      data[currentArray].push(currentItem);
      continue;
    }

    const nested = line.match(/^\s{4}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && currentItem) currentItem[nested[1]] = scalar(nested[2]);
  }

  return data;
}

function normalizedKey(data) {
  const name = String(data.title || '').trim();
  if (!name) return null;
  const owner = String(data.object || '').trim();
  return (owner ? `${owner}.${name}` : name).toLowerCase();
}

function parameterSummary(parameters) {
  if (!Array.isArray(parameters)) return '';
  return parameters
    .filter(p => p && p.name)
    .map(p => {
      const bits = [String(p.name)];
      if (p.type) bits.push(`As ${p.type}`);
      if (p.required === false) bits.push('(optional)');
      return bits.join(' ');
    })
    .join('; ');
}

function descriptionFrom(data) {
  const description = String(data.shortDescription || '').trim();
  if (!description) return '';
  if (!Array.isArray(data.parameters) || data.parameters.length === 0) return description;
  const parameterHelp = data.parameters
    .filter(p => p?.name && p?.description)
    .map(p => `${p.name}: ${p.description}`)
    .join(' ');
  return parameterHelp ? `${description}\n\n${parameterHelp}` : description;
}

function mergeAstroItem(data, relativePath) {
  if (data.migration !== 'complete') return;
  if (!['function', 'property', 'object'].includes(data.type)) return;

  const key = normalizedKey(data);
  if (!key || removed.has(key)) return;

  const name = String(data.title || '').trim();
  const owner = String(data.object || '').trim() || undefined;
  const existing = byKey.get(key);
  const sourceName = `docs/astro-foundation/docs/${relativePath.replaceAll('\\', '/')}`;
  const description = descriptionFrom(data) || existing?.description || '';

  if (data.type === 'function') {
    const item = {
      ...(existing || {}),
      name,
      qualifiedName: owner ? `${owner}.${name}` : name,
      ...(owner ? { owner } : {}),
      kind: existing?.kind || 'function',
      syntax: String(data.syntax || existing?.syntax || `${name}()`),
      parameters: parameterSummary(data.parameters) || existing?.parameters || '',
      description,
      ...(data.returnType ? { returnType: String(data.returnType) } : existing?.returnType ? { returnType: existing.returnType } : {}),
      source: sourceName,
      section: String(data.category || existing?.section || 'Astro Docs')
    };
    byKey.set(key, item);
    return;
  }

  if (data.type === 'property') {
    if (!owner) return;
    const item = {
      ...(existing || {}),
      name,
      qualifiedName: `${owner}.${name}`,
      owner,
      kind: 'property',
      syntax: String(data.syntax || existing?.syntax || `${owner}.${name}`),
      parameters: '',
      description,
      ...(data.dataType ? { returnType: String(data.dataType) } : existing?.returnType ? { returnType: existing.returnType } : {}),
      ...(data.access === 'ReadWrite' ? { writable: true } : existing?.writable ? { writable: existing.writable } : {}),
      source: sourceName,
      section: owner
    };
    byKey.set(key, item);
    return;
  }

  const item = {
    ...(existing || {}),
    name,
    qualifiedName: name,
    kind: 'class',
    syntax: String(data.syntax || existing?.syntax || `Dim value As New ${name}`),
    parameters: existing?.parameters || '',
    description,
    source: sourceName,
    section: String(data.category || existing?.section || 'Astro Docs')
  };
  byKey.set(key, item);
}

const docsDir = path.join(docsRepo, 'docs');
let applied = 0;
for (const file of walk(docsDir)) {
  const data = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!data) continue;
  const before = byKey.size;
  const key = normalizedKey(data);
  const oldValue = key ? byKey.get(key) : undefined;
  mergeAstroItem(data, path.relative(docsDir, file));
  if (key && byKey.get(key) !== oldValue) applied++;
  else if (byKey.size !== before) applied++;
}

for (const key of removed) byKey.delete(key);
const catalog = [...byKey.values()].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Applied Astro Docs help metadata to ${applied} IntelliSense entries. Catalog contains ${catalog.length} items.`);
