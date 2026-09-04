import fs from 'node:fs';
import path from 'node:path';

const docsRepo = process.env.XPSCRIPT_ASTRO_DOCS_PATH || process.argv[2];
const outFile = path.resolve('src/generated/apiCatalog.ts');
if (!docsRepo || !fs.existsSync(path.join(docsRepo, 'docs')) || !fs.existsSync(outFile)) process.exit(0);

let source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const byKey = new Map(items.map(item => [item.qualifiedName.toLowerCase(), item]));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

function scalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return value.slice(1, -1); } }
    return value.slice(1, -1);
  }
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
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
    const top = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (top) {
      currentItem = null;
      if (!top[2].trim()) { data[top[1]] = []; currentArray = top[1]; }
      else { data[top[1]] = scalar(top[2]); currentArray = null; }
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

let applied = 0;
for (const file of walk(path.join(docsRepo, 'docs'))) {
  const data = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!data || data.migration !== 'complete' || data.type !== 'function' || !Array.isArray(data.parameters)) continue;
  const name = String(data.title || '').trim();
  const owner = String(data.object || '').trim();
  const key = (owner ? `${owner}.${name}` : name).toLowerCase();
  const item = byKey.get(key);
  if (!item) continue;
  item.description = String(data.shortDescription || item.description || '').trim();
  item.parameterDetails = data.parameters.filter(p => p?.name).map(p => ({
    name: String(p.name),
    ...(p.type ? { type: String(p.type) } : {}),
    required: p.required !== false,
    ...(p.default !== undefined ? { default: p.default } : {}),
    description: String(p.description || '').trim()
  }));
  applied++;
}

let header = source.slice(0, jsonStart);
if (!header.includes('export interface ApiParameter')) {
  header = header.replace(
    "export interface ApiItem {",
    "export interface ApiParameter {\n  name: string;\n  type?: string;\n  required: boolean;\n  default?: string | number | boolean | null;\n  description: string;\n}\n\nexport interface ApiItem {"
  );
}
if (!header.includes('parameterDetails?: ApiParameter[];')) {
  header = header.replace('  parameters: string;\n', '  parameters: string;\n  parameterDetails?: ApiParameter[];\n');
}
const catalog = [...byKey.values()].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Applied structured parameter help to ${applied} IntelliSense entries.`);
