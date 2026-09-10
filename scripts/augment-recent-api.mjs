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

// ArraySort was added as a prose-only API page, so the generic Markdown table parser cannot discover it.
add({ name:'ArraySort', qualifiedName:'ArraySort', kind:'function', syntax:'ArraySort(array)', parameters:'array', description:'Returns a sorted copy of a one-dimensional typed array while preserving its element type and lower bound.', source:'docs/array-sort.md', section:'ArraySort' });

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


// NotesName, NotesDateTime, NotesAgent, NotesDocument, NotesView and the rest of the
// native Notes object model are synchronized from docs/notes-c-api.md by
// sync-current-public-api.mjs. Do not duplicate them here: hard-coded copies
// drifted from the canonical XPscript documentation and masked missing updates.

// NotesMIMEEntity / NotesMIMEHeader current verified public surface.
// docs/notes-mime-entity.md is intentionally prose-oriented, so explicitly model it for IntelliSense.
const mimeSource = 'docs/notes-mime-entity.md';
add({ name:'NotesMIMEEntity', qualifiedName:'NotesMIMEEntity', kind:'class', syntax:'Dim mime As NotesMIMEEntity', parameters:'', description:'Native Notes/Domino MIME entity wrapper for the documented root, child and nested MIME surface.', source:mimeSource, section:'NotesMIMEEntity' });
add({ name:'NotesMIMEHeader', qualifiedName:'NotesMIMEHeader', kind:'class', syntax:'Dim header As NotesMIMEHeader', parameters:'', description:'MIME header wrapper owned by a NotesMIMEEntity.', source:mimeSource, section:'NotesMIMEHeader' });

for (const [owner, name, syntax, parameters, returnType, description] of [
  ['NotesDocument','GetMIMEEntity','doc.GetMIMEEntity([itemName])','itemName','NotesMIMEEntity','Opens the native MIME root entity. Document-level access currently supports Body.'],
  ['NotesDocument','CreateMIMEEntity','doc.CreateMIMEEntity([itemName])','itemName','NotesMIMEEntity','Creates the native MIME root entity. Document-level access currently supports Body.'],
  ['NotesDocument','CloseMIMEEntities','doc.CloseMIMEEntities()','','','Closes the current MIME directory and invalidates directory-backed entity handles.'],
  ['NotesItem','GetMIMEEntity','item.GetMIMEEntity()','','NotesMIMEEntity','Returns the MIME entity for a MIME Body item.']
]) add({ name, qualifiedName:`${owner}.${name}`, owner, kind:'function', syntax, parameters, ...(returnType ? { returnType } : {}), description, source:mimeSource, section:'MIME document/item access' });

for (const [name, returnType, writable, description] of [
  ['Parent','NotesDocument',false,'Owning NotesDocument.'],
  ['BoundaryStart','String',false,'Opening multipart boundary marker when available.'],
  ['BoundaryEnd','String',false,'Closing multipart boundary marker when available.'],
  ['Charset','String',false,'MIME charset parameter.'],
  ['ContentAsText','String',false,'Decoded entity content as text.'],
  ['ContentType','String',false,'MIME primary content type.'],
  ['ContentSubType','String',false,'MIME content subtype.'],
  ['ContentID','String',false,'Content-ID value.'],
  ['ContentLocation','String',false,'Content-Location value.'],
  ['Encoding','Integer',false,'Notes MIME transfer-encoding constant.'],
  ['Headers','String',false,'Serialized MIME headers.'],
  ['HeaderObjects','Variant',false,'Array of NotesMIMEHeader objects.'],
  ['Preamble','String',true,'Multipart preamble text.'],
  ['InputStream','NotesStream',false,'New NotesStream containing decoded entity bytes, positioned at zero.'],
  ['Reader','NotesStream',false,'New NotesStream containing decoded text using the entity charset, positioned at zero.'],
  ['IsMultipart','Boolean',false,'True when the native entity is multipart.'],
  ['IsDiscretePart','Boolean',false,'True when the native entity is a discrete MIME part.'],
  ['IsMessagePart','Boolean',false,'True when the native entity is a message MIME part.'],
  ['IsRecycled','Boolean',false,'True after the wrapper has been recycled.']
]) add({ name, qualifiedName:`NotesMIMEEntity.${name}`, owner:'NotesMIMEEntity', kind:'property', syntax:`mime.${name}`, parameters:'', returnType, writable, description, source:mimeSource, section:'NotesMIMEEntity properties' });

for (const [name, syntax, parameters, returnType, description] of [
  ['GetFirstChildEntity','mime.GetFirstChildEntity()','','NotesMIMEEntity','Returns the first child entity or Nothing.'],
  ['GetParentEntity','mime.GetParentEntity()','','NotesMIMEEntity','Returns the parent entity or Nothing.'],
  ['GetNextSibling','mime.GetNextSibling()','','NotesMIMEEntity','Returns the next sibling entity or Nothing.'],
  ['GetPrevSibling','mime.GetPrevSibling()','','NotesMIMEEntity','Returns the previous sibling entity or Nothing.'],
  ['GetNextEntity','mime.GetNextEntity([search])','search','NotesMIMEEntity','Returns the next entity in depth-first traversal. SEARCH_DEPTH is the supported search mode.'],
  ['GetChildren','mime.GetChildren()','','Variant','Returns an array of direct child NotesMIMEEntity objects.'],
  ['CreateChildEntity','mime.CreateChildEntity([nextSibling])','nextSibling','NotesMIMEEntity','Creates a direct or nested multipart child, optionally before a sibling.'],
  ['AppendChildEntity','mime.AppendChildEntity(child)','child','','Moves/appends a direct child to the end of this parent.'],
  ['RemoveChildEntity','mime.RemoveChildEntity(child)','child','','Removes a direct child entity.'],
  ['CreateHeader','mime.CreateHeader(name [, value])','name; value','NotesMIMEHeader','Creates a MIME header, optionally assigning its initial value.'],
  ['GetNthHeader','mime.GetNthHeader(name [, occurrence])','name; occurrence','NotesMIMEHeader','Returns a case-insensitive MIME header occurrence. Occurrences are one-based.'],
  ['GetHeaders','mime.GetHeaders([name])','name','Variant','Returns all headers or headers filtered by case-insensitive name.'],
  ['GetSomeHeaders','mime.GetSomeHeaders(names)','names','String','Returns serialized text for selected comma-separated header names.'],
  ['RemoveHeaders','mime.RemoveHeaders(name)','name','','Removes headers matching the supplied name.'],
  ['GetContentAsBytes','mime.GetContentAsBytes(stream)','stream','','Writes decoded entity bytes to a NotesStream.'],
  ['GetContentAsText','mime.GetContentAsText(stream [, entityCharset])','stream; entityCharset','','Writes decoded entity text to a NotesStream.'],
  ['GetEntityAsText','mime.GetEntityAsText(stream)','stream','','Writes the complete serialized MIME entity to a NotesStream.'],
  ['GetInputStream','mime.GetInputStream(decode)','decode','NotesStream','Returns a NotesStream containing stored or decoded bytes.'],
  ['SetContentFromText','mime.SetContentFromText(stream, contentType, encoding)','stream; contentType; encoding','','Replaces entity content from text using the requested MIME content type and transfer encoding.'],
  ['SetContentFromBytes','mime.SetContentFromBytes(stream, contentType, encoding)','stream; contentType; encoding','','Replaces entity content from bytes using the requested MIME content type and transfer encoding.'],
  ['EncodeContent','mime.EncodeContent(encoding)','encoding','','Rewrites the entity transfer encoding while preserving content.'],
  ['DecodeContent','mime.DecodeContent()','','','Decodes/re-encodes content to the default decoded representation.'],
  ['Remove','mime.Remove()','','','Removes the MIME entity/item from its parent/document where supported.'],
  ['Recycle','mime.Recycle()','','','Invalidates the MIME entity wrapper.']
]) add({ name, qualifiedName:`NotesMIMEEntity.${name}`, owner:'NotesMIMEEntity', kind:'function', syntax, parameters, ...(returnType ? { returnType } : {}), description, source:mimeSource, section:'NotesMIMEEntity methods' });

for (const [name, returnType, description] of [
  ['Parent','NotesMIMEEntity','Owning MIME entity.'],
  ['HeaderName','String','MIME header name.'],
  ['IsRecycled','Boolean','True after the wrapper has been recycled.']
]) add({ name, qualifiedName:`NotesMIMEHeader.${name}`, owner:'NotesMIMEHeader', kind:'property', syntax:`header.${name}`, parameters:'', returnType, writable:false, description, source:mimeSource, section:'NotesMIMEHeader properties' });

for (const [name, syntax, parameters, returnType, description] of [
  ['GetHeaderVal','header.GetHeaderVal()','','String','Returns the MIME header value.'],
  ['GetHeaderValAndParams','header.GetHeaderValAndParams()','','String','Returns the complete MIME header value including parameters.'],
  ['GetParamVal','header.GetParamVal(name)','name','String','Returns a semicolon-delimited MIME parameter value.'],
  ['SetHeaderVal','header.SetHeaderVal(value)','value','','Sets the MIME header value.'],
  ['SetHeaderValAndParams','header.SetHeaderValAndParams(value)','value','','Sets the complete MIME header value including parameters.'],
  ['AddValText','header.AddValText(value)','value','','Appends text to the current header value.'],
  ['SetParamVal','header.SetParamVal(name, value)','name; value','','Replaces or adds a quoted MIME header parameter.'],
  ['Remove','header.Remove()','','','Removes this MIME header.'],
  ['Recycle','header.Recycle()','','','Invalidates the MIME header wrapper.']
]) add({ name, qualifiedName:`NotesMIMEHeader.${name}`, owner:'NotesMIMEHeader', kind:'function', syntax, parameters, ...(returnType ? { returnType } : {}), description, source:mimeSource, section:'NotesMIMEHeader methods' });

for (const [name, value, description] of [
  ['SEARCH_BREADTH','1723','MIME breadth traversal constant. The current GetNextEntity(search) implementation supports SEARCH_DEPTH.'],
  ['SEARCH_DEPTH','1724','MIME depth-first traversal constant.']
]) add({ name, qualifiedName:`NotesConst.${name}`, owner:'NotesConst', kind:'property', syntax:`NotesConst.${name}`, parameters:'', returnType:'Integer', writable:false, description:`${description} Value ${value}.`, source:mimeSource, section:'MIME constants' });

const catalog = [...byKey.values()].sort((a,b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Augmented recent XPscript API surfaces. Catalog contains ${catalog.length} items.`);
