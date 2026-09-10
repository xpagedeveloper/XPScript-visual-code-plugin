import fs from 'node:fs';

const outFile = 'src/generated/apiCatalog.ts';
const source = fs.readFileSync(outFile, 'utf8');
const marker = 'export const apiCatalog: ApiItem[] = ';
const start = source.indexOf(marker);
if (start < 0) throw new Error('apiCatalog marker not found');
const jsonStart = start + marker.length;
const jsonEnd = source.lastIndexOf(';');
if (jsonEnd <= jsonStart) throw new Error('apiCatalog terminator not found');

const items = JSON.parse(source.slice(jsonStart, jsonEnd));
const byKey = new Map(items.map(item => [item.qualifiedName.toLowerCase(), item]));
const add = item => byKey.set(item.qualifiedName.toLowerCase(), item);

// Debugger API added with debugger protocol/runtime work.
const debuggerSource = 'src/XPScript.Compiler/SourceLineRuntimeSource.cs';
add({ name:'Debugger', qualifiedName:'Debugger', kind:'class', syntax:'Debugger.Member', parameters:'', description:'Debugger-only helper object. Calls are ignored when the XPscript debugger is not enabled.', source:debuggerSource, section:'Debugger API' });
add({ name:'Print', qualifiedName:'Debugger.Print', owner:'Debugger', kind:'function', syntax:'Debugger.Print(value)', parameters:'value', description:'Writes a value to the XPscript debugger output without writing to normal program output.', source:debuggerSource, section:'Debugger API' });
add({ name:'UpdateVar', qualifiedName:'Debugger.UpdateVar', owner:'Debugger', kind:'function', syntax:'Debugger.UpdateVar(name, value)', parameters:'name; value', description:'Creates or updates a named debugger variable that participates in debugger inspection and breakpoint evaluation.', source:debuggerSource, section:'Debugger API' });

// Application.Executable metadata added 2026-09-09. Use an explicit nested type so member completion works through Application.Executable.
const applicationSource = 'docs/application-reference.md';
add({ name:'Executable', qualifiedName:'Application.Executable', owner:'Application', kind:'property', syntax:'Application.Executable', parameters:'', returnType:'ApplicationExecutable', description:'Executable metadata object used by the compiler and available at runtime.', source:applicationSource, section:'Executable metadata' });
add({ name:'ApplicationExecutable', qualifiedName:'ApplicationExecutable', kind:'class', syntax:'Application.Executable', parameters:'', description:'Metadata for the generated executable.', source:applicationSource, section:'Executable metadata' });
for (const [name, description] of [
  ['Icon','Executable icon path. Windows executable icons must use an .ico file.'],
  ['FileDescription','Generated executable/assembly file description.'],
  ['Product','Generated executable/assembly product name.'],
  ['Company','Generated executable/assembly company name.'],
  ['Version','Generated executable and assembly version string.'],
  ['Copyright','Generated executable/assembly copyright text.'],
  ['Comments','Generated executable comments metadata.']
]) add({ name, qualifiedName:`ApplicationExecutable.${name}`, owner:'ApplicationExecutable', kind:'property', syntax:`Application.Executable.${name}`, parameters:'', writable:true, description, source:applicationSource, section:'Executable metadata' });

// NotesDBDirectory API added 2026-09-07/08.
const dbDirectorySource = 'docs/notes-dbdirectory.md';
add({ name:'NotesDBDirectory', qualifiedName:'NotesDBDirectory', kind:'class', syntax:'Dim directory As NotesDBDirectory', parameters:'', description:'Notes/Domino database-directory enumeration object owned by a NotesSession.', source:dbDirectorySource, section:'NotesDBDirectory' });
add({ name:'GetDbDirectory', qualifiedName:'NotesSession.GetDbDirectory', owner:'NotesSession', kind:'function', syntax:'session.GetDbDirectory(server)', parameters:'server', returnType:'NotesDBDirectory', description:'Creates a NotesDBDirectory for the local data directory or a Domino server.', source:dbDirectorySource, section:'NotesSession.GetDbDirectory' });
for (const [name, returnType, description] of [
  ['Name', undefined, 'Server name supplied to GetDbDirectory.'],
  ['Parent', 'NotesSession', 'Owning NotesSession.'],
  ['IsRecycled', undefined, 'Reports whether the directory wrapper has been recycled.']
]) add({ name, qualifiedName:`NotesDBDirectory.${name}`, owner:'NotesDBDirectory', kind:'property', syntax:`directory.${name}`, parameters:'', ...(returnType ? { returnType } : {}), description, source:dbDirectorySource, section:'Properties' });
for (const [name, syntax, parameters, returnType, description] of [
  ['GetFirstDatabase','directory.GetFirstDatabase(type)','type','NotesDatabase','Starts or resets directory enumeration and returns the first matching database or Nothing.'],
  ['GetNextDatabase','directory.GetNextDatabase()','','NotesDatabase','Returns the next database in the current enumeration or Nothing.'],
  ['OpenDatabase','directory.OpenDatabase(filePath)','filePath','NotesDatabase','Opens a database through the owning NotesSession.'],
  ['Recycle','directory.Recycle()','','','Recycles the directory wrapper and clears enumeration state.']
]) add({ name, qualifiedName:`NotesDBDirectory.${name}`, owner:'NotesDBDirectory', kind:'function', syntax, parameters, ...(returnType ? { returnType } : {}), description, source:dbDirectorySource, section:'Functions and methods' });
for (const [name, value, description] of [
  ['REPLICA_CANDIDATE','1245','Replica-candidate databases.'],
  ['TEMPLATE_CANDIDATE','1246','Template-candidate databases.'],
  ['DATABASE','1247','Databases.'],
  ['TEMPLATE','1248','Templates.']
]) add({ name, qualifiedName:`NotesConst.${name}`, owner:'NotesConst', kind:'property', syntax:`NotesConst.${name}`, parameters:'', description:`${description} Value ${value}.`, source:dbDirectorySource, section:'Database type constants' });

const catalog = [...byKey.values()].sort((a,b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Augmented recent XPscript API surfaces. Catalog contains ${catalog.length} items.`);
