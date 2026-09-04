import fs from 'node:fs';
import path from 'node:path';

const candidates = [process.env.XPSCRIPT_REPO_PATH, process.argv[2], path.resolve('..', 'XPscript'), path.resolve('xpscript-source')].filter(Boolean);
const repo = candidates.find(p => fs.existsSync(path.join(p, 'docs')));
const outFile = path.resolve('src/generated/apiCatalog.ts');

if (!repo) {
  if (fs.existsSync(outFile)) {
    console.log('XPscript source repo not found, keeping committed catalog.');
    process.exit(0);
  }
  console.error('XPscript source repo not found. Set XPSCRIPT_REPO_PATH.');
  process.exit(1);
}

const docsDir = path.join(repo, 'docs');
const preferred = [
  'application-reference.md',
  'file-io-reference.md',
  'desktop-ui-reference.md',
  'native-interop-reference.md',
  'file-existence-reference.md',
  'api-reference.md',
  'commands.md'
];
const rest = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && !preferred.includes(f));
const files = [...preferred.filter(f => fs.existsSync(path.join(docsDir, f))), ...rest];

const sectionOwners = new Map([
  ['Native HTTP client', 'HttpClient'], ['HTTP response', 'HttpResponse'], ['SQLite', 'XPDBSQLite'],
  ['SQL Server', 'XPDbMsSql'], ['Supabase HTTP database', 'HTTPDBSupabase'], ['Domino REST database', 'HTTPDBDominoRest'],
  ['XPAi', 'XPAi'], ['AITool', 'AITool'], ['UIForm', 'UIForm'], ['UIListView', 'UIListView'],
  ['Response', 'Response'], ['Session', 'Session'], ['RequestScope', 'RequestScope']
]);

const knownReturnTypes = {
  'HttpClient.Get': 'HttpResponse', 'HttpClient.Post': 'HttpResponse', 'HttpClient.Put': 'HttpResponse',
  'HttpClient.Patch': 'HttpResponse', 'HttpClient.Delete': 'HttpResponse', 'HttpClient.GetJson': 'JsonDocument',
  'HttpResponse.Json': 'JsonDocument', 'JsonDocument.Parse': 'JsonDocument', 'JsonParse': 'JsonDocument',
  'JsonDecode': 'JsonDocument', 'XPDBSQLite.Query': 'JsonDocument', 'XPDbMsSql.Query': 'JsonDocument',
  'UIListView.GetSelectedRow': 'JsonObject', 'FileInfo': 'FileInfo', 'Application.State': 'State',
  'Process.State': 'State', 'Session.State': 'State', 'Request.State': 'State'
};
const writable = new Set([
  'Application.ExitCode','Application.Title','Application.Icon','Application.Width','Application.Height',
  'HttpClient.Timeout','XPDBSQLite.Timeout','XPDBSQLite.MaxRows','XPDbMsSql.Timeout','XPDbMsSql.MaxRows',
  'Response.StatusCode','Response.ContentType'
]);

const items = new Map();
const clean = s => s.trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|');
const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
const keyFor = item => item.qualifiedName.toLowerCase();
const normalizeName = raw => raw.replace(/^`|`$/g, '').replace(/\(.*$/, '').trim();

function explicitOwner(name) {
  if (!name.includes('.')) return undefined;
  return name.slice(0, name.lastIndexOf('.'));
}

function inferKind(name, syntax, owner) {
  if (/^(Option\b|Dim$|Static$|Sub$|Function$|Call$|If$|ElseIf$|Else$|Select Case$|For$|ForAll$|GoTo$|GoSub$|Return$|On Error$|Resume$|Error$|With$|ReDim\b|Erase$|Open\b|Close$|Reset$|Print #$|Write #$|Line Input #$|Input #$|Put$|Get$|Lock$|Unlock$|Kill$|Name$|MkDir$|RmDir$|ChDir$|ChDrive$)/i.test(name)) return 'keyword';
  if (/\bNew\s+/i.test(syntax) && !owner) return 'class';
  if (owner && !syntax.includes('(')) return 'property';
  return 'function';
}

for (const file of files) {
  const text = fs.readFileSync(path.join(docsDir, file), 'utf8');
  let heading = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,4}\s+/.test(line)) heading = line.replace(/^#+\s+/, '').trim();
    if (!line.trim().startsWith('|')) continue;
    const header = splitRow(line).map(x => x.toLowerCase());
    if (!(header.includes('syntax') && (header.includes('member') || header.includes('command') || header.includes('command/property') || header.includes('rule/member')))) continue;
    if (i + 1 >= lines.length || !/^\|?\s*[-:]+/.test(lines[i + 1])) continue;
    const nameIdx = Math.max(header.indexOf('member'), header.indexOf('command'), header.indexOf('command/property'), header.indexOf('rule/member'));
    const syntaxIdx = header.indexOf('syntax');
    const paramsIdx = header.indexOf('parameters');
    const descIdx = header.indexOf('description');
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const cells = splitRow(lines[i]);
      if (!cells[nameIdx] || !cells[syntaxIdx]) continue;
      const rawName = normalizeName(cells[nameIdx]);
      const syntax = cells[syntaxIdx];
      const explicit = explicitOwner(rawName);
      const headingOwner = file === 'api-reference.md' ? sectionOwners.get(heading) : undefined;
      const owner = explicit ?? headingOwner;
      const name = explicit ? rawName.slice(rawName.lastIndexOf('.') + 1) : rawName;
      const qualifiedName = owner ? `${owner}.${name}` : name;
      const item = {
        name, qualifiedName, owner,
        kind: inferKind(name, syntax, owner),
        syntax,
        parameters: paramsIdx >= 0 ? cells[paramsIdx] || '' : '',
        description: descIdx >= 0 ? cells[descIdx] || '' : '',
        returnType: knownReturnTypes[qualifiedName],
        writable: writable.has(qualifiedName),
        source: `docs/${file}`,
        section: heading
      };
      if (!items.has(keyFor(item))) items.set(keyFor(item), item);
    }
  }
}

for (const name of ['Name','FullPath','Extension','Length','Created','Modified','Accessed','IsFile','IsDirectory','IsLink','Attributes']) {
  const item = { name, qualifiedName: `FileInfo.${name}`, owner: 'FileInfo', kind: 'property', syntax: `fileInfo.${name}`, parameters: '', description: `FileInfo ${name} property.`, source: 'docs/file-io-reference.md', section: 'FileInfo' };
  if (!items.has(keyFor(item))) items.set(keyFor(item), item);
}

const catalog = [...items.values()].sort((a,b) => a.qualifiedName.localeCompare(b.qualifiedName));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const source = `// Generated from XPscript docs. Do not edit manually.\nexport type ApiItemKind = 'keyword' | 'function' | 'property' | 'class';\nexport interface ApiItem { name:string; qualifiedName:string; owner?:string; kind:ApiItemKind; syntax:string; parameters:string; description:string; returnType?:string; writable?:boolean; source:string; section:string; }\nexport const apiCatalog: ApiItem[] = ${JSON.stringify(catalog, null, 2)};\n`;
fs.writeFileSync(outFile, source);
console.log(`Generated ${catalog.length} XPscript IntelliSense items from ${files.length} docs files.`);
