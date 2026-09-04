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

function addItem(item) {
  if (!items.has(keyFor(item))) items.set(keyFor(item), item);
}

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
      addItem({
        name, qualifiedName, owner,
        kind: inferKind(name, syntax, owner),
        syntax,
        parameters: paramsIdx >= 0 ? cells[paramsIdx] || '' : '',
        description: descIdx >= 0 ? cells[descIdx] || '' : '',
        returnType: knownReturnTypes[qualifiedName],
        writable: writable.has(qualifiedName),
        source: `docs/${file}`,
        section: heading
      });
    }
  }
}

for (const name of ['Name','FullPath','Extension','Length','Created','Modified','Accessed','IsFile','IsDirectory','IsLink','Attributes']) {
  addItem({ name, qualifiedName: `FileInfo.${name}`, owner: 'FileInfo', kind: 'property', syntax: `fileInfo.${name}`, parameters: '', description: `FileInfo ${name} property.`, source: 'docs/file-io-reference.md', section: 'FileInfo' });
}

// docs/native-csv.md documents its public API as prose and bullet lists rather than
// the Member|Syntax table format used by the main references. Keep this explicit list
// tied to that document so the extension exposes only the public CSV surface.
const csvSource = 'docs/native-csv.md';
const csvSection = 'Native CSV';
const csvItems = [
  { name: 'CsvDocument', qualifiedName: 'CsvDocument', kind: 'class', syntax: 'Dim doc As New CsvDocument', parameters: '', description: 'Creates an empty CSV document.', source: csvSource, section: csvSection },
  { name: 'CsvParse', qualifiedName: 'CsvParse', kind: 'function', syntax: 'CsvParse(text [, delimiter [, hasHeaders]])', parameters: 'text; delimiter; hasHeaders', description: 'Parses CSV text.', returnType: 'CsvDocument', source: csvSource, section: csvSection },
  { name: 'CsvParseBytes', qualifiedName: 'CsvParseBytes', kind: 'function', syntax: 'CsvParseBytes(bytes, encoding [, delimiter [, hasHeaders]])', parameters: 'bytes; encoding; delimiter; hasHeaders', description: 'Parses CSV byte data using an explicit encoding.', returnType: 'CsvDocument', source: csvSource, section: csvSection },
  { name: 'CsvStringify', qualifiedName: 'CsvStringify', kind: 'function', syntax: 'CsvStringify(document)', parameters: 'document', description: 'Serializes a CsvDocument to CSV text.', source: csvSource, section: csvSection },
  { name: 'CsvEscape', qualifiedName: 'CsvEscape', kind: 'function', syntax: 'CsvEscape(value [, delimiter])', parameters: 'value; delimiter', description: 'Escapes one CSV field value.', source: csvSource, section: csvSection },

  { name: 'Parse', qualifiedName: 'CsvDocument.Parse', owner: 'CsvDocument', kind: 'function', syntax: 'CsvDocument.Parse(text [, delimiter [, hasHeaders]])', parameters: 'text; delimiter; hasHeaders', description: 'Parses CSV text.', returnType: 'CsvDocument', source: csvSource, section: csvSection },
  { name: 'ParseBytes', qualifiedName: 'CsvDocument.ParseBytes', owner: 'CsvDocument', kind: 'function', syntax: 'CsvDocument.ParseBytes(bytes, encoding [, delimiter [, hasHeaders]])', parameters: 'bytes; encoding; delimiter; hasHeaders', description: 'Parses CSV bytes using an explicit encoding.', returnType: 'CsvDocument', source: csvSource, section: csvSection },
  { name: 'Headers', qualifiedName: 'CsvDocument.Headers', owner: 'CsvDocument', kind: 'property', syntax: 'doc.Headers', parameters: '', description: 'Indexed and iterable collection of CSV headers.', returnType: 'CsvHeaderCollection', source: csvSource, section: csvSection },
  { name: 'Rows', qualifiedName: 'CsvDocument.Rows', owner: 'CsvDocument', kind: 'property', syntax: 'doc.Rows', parameters: '', description: 'Indexed and iterable collection of CSV rows.', returnType: 'CsvRowCollection', source: csvSource, section: csvSection },
  { name: 'RowCount', qualifiedName: 'CsvDocument.RowCount', owner: 'CsvDocument', kind: 'property', syntax: 'doc.RowCount', parameters: '', description: 'Number of data rows.', source: csvSource, section: csvSection },
  { name: 'ColumnCount', qualifiedName: 'CsvDocument.ColumnCount', owner: 'CsvDocument', kind: 'property', syntax: 'doc.ColumnCount', parameters: '', description: 'Number of columns.', source: csvSource, section: csvSection },
  { name: 'HasHeaders', qualifiedName: 'CsvDocument.HasHeaders', owner: 'CsvDocument', kind: 'property', syntax: 'doc.HasHeaders', parameters: '', description: 'Controls whether the document treats the first record as headers.', writable: true, source: csvSource, section: csvSection },
  { name: 'Delimiter', qualifiedName: 'CsvDocument.Delimiter', owner: 'CsvDocument', kind: 'property', syntax: 'doc.Delimiter', parameters: '', description: 'CSV delimiter. Comma and semicolon are supported.', writable: true, source: csvSource, section: csvSection },
  { name: 'Encoding', qualifiedName: 'CsvDocument.Encoding', owner: 'CsvDocument', kind: 'property', syntax: 'doc.Encoding', parameters: '', description: 'Encoding used when serializing the document to bytes.', writable: true, source: csvSource, section: csvSection },
  { name: 'AddHeader', qualifiedName: 'CsvDocument.AddHeader', owner: 'CsvDocument', kind: 'function', syntax: 'doc.AddHeader(name)', parameters: 'name', description: 'Adds a header and extends existing rows with an empty value.', source: csvSource, section: csvSection },
  { name: 'AddRow', qualifiedName: 'CsvDocument.AddRow', owner: 'CsvDocument', kind: 'function', syntax: 'doc.AddRow()', parameters: '', description: 'Adds a row to the document.', returnType: 'CsvRow', source: csvSource, section: csvSection },
  { name: 'Stringify', qualifiedName: 'CsvDocument.Stringify', owner: 'CsvDocument', kind: 'function', syntax: 'doc.Stringify()', parameters: '', description: 'Serializes the document to CSV text.', source: csvSource, section: csvSection },
  { name: 'ToBytes', qualifiedName: 'CsvDocument.ToBytes', owner: 'CsvDocument', kind: 'function', syntax: 'doc.ToBytes([encoding])', parameters: 'encoding', description: 'Serializes the document to bytes using the document encoding or an explicit encoding.', source: csvSource, section: csvSection },

  { name: 'Count', qualifiedName: 'CsvHeaderCollection.Count', owner: 'CsvHeaderCollection', kind: 'property', syntax: 'headers.Count', parameters: '', description: 'Number of headers.', source: csvSource, section: csvSection },
  { name: 'Get', qualifiedName: 'CsvHeaderCollection.Get', owner: 'CsvHeaderCollection', kind: 'function', syntax: 'headers.Get(index)', parameters: 'index', description: 'Returns the header at a zero-based index.', returnType: 'String', source: csvSource, section: csvSection },
  { name: 'Count', qualifiedName: 'CsvRowCollection.Count', owner: 'CsvRowCollection', kind: 'property', syntax: 'rows.Count', parameters: '', description: 'Number of rows.', source: csvSource, section: csvSection },
  { name: 'Get', qualifiedName: 'CsvRowCollection.Get', owner: 'CsvRowCollection', kind: 'function', syntax: 'rows.Get(index)', parameters: 'index', description: 'Returns the row at a zero-based index.', returnType: 'CsvRow', source: csvSource, section: csvSection },
  { name: 'Count', qualifiedName: 'CsvColumnCollection.Count', owner: 'CsvColumnCollection', kind: 'property', syntax: 'columns.Count', parameters: '', description: 'Number of columns in the row.', source: csvSource, section: csvSection },
  { name: 'Get', qualifiedName: 'CsvColumnCollection.Get', owner: 'CsvColumnCollection', kind: 'function', syntax: 'columns.Get(index)', parameters: 'index', description: 'Returns the column at a zero-based index.', returnType: 'CsvColumn', source: csvSource, section: csvSection },

  { name: 'Count', qualifiedName: 'CsvRow.Count', owner: 'CsvRow', kind: 'property', syntax: 'row.Count', parameters: '', description: 'Number of values in the row.', source: csvSource, section: csvSection },
  { name: 'Columns', qualifiedName: 'CsvRow.Columns', owner: 'CsvRow', kind: 'property', syntax: 'row.Columns', parameters: '', description: 'Indexed and iterable collection of columns in the row.', returnType: 'CsvColumnCollection', source: csvSource, section: csvSection },
  { name: 'Get', qualifiedName: 'CsvRow.Get', owner: 'CsvRow', kind: 'function', syntax: 'row.Get(indexOrName)', parameters: 'indexOrName', description: 'Returns a value by zero-based column index or case-insensitive header name.', returnType: 'String', source: csvSource, section: csvSection },
  { name: 'Set', qualifiedName: 'CsvRow.Set', owner: 'CsvRow', kind: 'function', syntax: 'row.Set(indexOrName, value)', parameters: 'indexOrName; value', description: 'Sets an existing value by zero-based index or header name.', source: csvSource, section: csvSection },

  { name: 'Index', qualifiedName: 'CsvColumn.Index', owner: 'CsvColumn', kind: 'property', syntax: 'column.Index', parameters: '', description: 'Zero-based column index.', source: csvSource, section: csvSection },
  { name: 'Name', qualifiedName: 'CsvColumn.Name', owner: 'CsvColumn', kind: 'property', syntax: 'column.Name', parameters: '', description: 'Column header name, or an empty string when headers are disabled.', source: csvSource, section: csvSection },
  { name: 'Value', qualifiedName: 'CsvColumn.Value', owner: 'CsvColumn', kind: 'property', syntax: 'column.Value', parameters: '', description: 'Column text value.', source: csvSource, section: csvSection }
];
for (const item of csvItems) addItem(item);

const catalog = [...items.values()].sort((a,b) => a.qualifiedName.localeCompare(b.qualifiedName));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const source = `// Generated from XPscript docs. Do not edit manually.\nexport type ApiItemKind = 'keyword' | 'function' | 'property' | 'class';\nexport interface ApiItem { name:string; qualifiedName:string; owner?:string; kind:ApiItemKind; syntax:string; parameters:string; description:string; returnType?:string; writable?:boolean; source:string; section:string; }\nexport const apiCatalog: ApiItem[] = ${JSON.stringify(catalog, null, 2)};\n`;
fs.writeFileSync(outFile, source);
console.log(`Generated ${catalog.length} XPscript IntelliSense items from ${files.length} docs files.`);
