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
const remove = qualifiedName => byKey.delete(qualifiedName.toLowerCase());
const add = item => byKey.set(item.qualifiedName.toLowerCase(), item);

// Removed in XPscript e40a2c4. These names now produce compiler errors.
for (const name of ['CsvSave', 'CsvWriteFile', 'XPCsvDocument.WriteFile']) remove(name);

const csvSource = 'docs/native-csv.md';
add({ name:'Sort', qualifiedName:'XPCsvDocument.Sort', owner:'XPCsvDocument', kind:'function', syntax:'csv.Sort(column)', parameters:'column', description:'Sorts rows in place using stable case-insensitive natural alphanumeric ordering. column is a header name or zero-based index.', source:csvSource, section:'Sort rows' });
add({ name:'Add', qualifiedName:'XPCsvHeaderCollection.Add', owner:'XPCsvHeaderCollection', kind:'function', syntax:'headers.Add(name)', parameters:'name', description:'Adds a header and extends existing rows with an empty value.', source:csvSource, section:'Headers, rows and columns' });
add({ name:'Save', qualifiedName:'XPCsvDocument.Save', owner:'XPCsvDocument', kind:'function', syntax:'csv.Save(path [, encoding])', parameters:'path; encoding', description:'Serializes the current CSV document and replaces the target file.', source:csvSource, section:'Save CSV files' });
add({ name:'SaveFile', qualifiedName:'XPCsvDocument.SaveFile', owner:'XPCsvDocument', kind:'function', syntax:'csv.SaveFile(path [, encoding])', parameters:'path; encoding', description:'Explicit file-named alias for Save.', source:csvSource, section:'Save CSV files' });

// XPAi prompt and structured-result surface.
const aiSource = 'docs/ai.md';
add({ name:'XPAiResponse', qualifiedName:'XPAiResponse', kind:'class', syntax:'Dim response As XPAiResponse', parameters:'', description:'Response returned by XPAi Complete and Stream.', source:aiSource, section:'Response' });
const aiProps = [
  ['SystemPrompt','ai.SystemPrompt','Gets or sets the first system prompt message.',true],
  ['UserPrompt','ai.UserPrompt','Gets or sets the final user prompt message.',true],
  ['JsonSchemaName','ai.JsonSchemaName','Gets or sets the structured-result schema name.',true],
  ['JsonSchemaStrict','ai.JsonSchemaStrict','Gets or sets strict JSON Schema request mode.',true],
  ['HasJsonSchema','ai.HasJsonSchema','Reports whether structured output is configured.',false],
  ['ResponseJsonSchema','ai.ResponseJsonSchema','Gets a cloned configured schema or sets a raw schema.',true,'XPJsonDocument']
];
for (const [name, syntax, description, writable, returnType] of aiProps) add({ name, qualifiedName:`XPAi.${name}`, owner:'XPAi', kind:'property', syntax, parameters:'', description, ...(writable ? {writable:true}:{}), ...(returnType ? {returnType}:{}), source:aiSource, section:'Complete API reference' });
const aiMethods = [
  ['SetPrompt','ai.SetPrompt(system, user)','system; user','Sets both prompt parts.'],
  ['ClearPrompt','ai.ClearPrompt()','','Clears both prompt parts.'],
  ['SetResultClass','ai.SetResultClass(contract [, name [, strict]])','contract; name; strict','Derives structured-result JSON Schema from an XPscript class instance.'],
  ['SetJsonSchema','ai.SetJsonSchema(schema [, name [, strict]])','schema; name; strict','Sets an explicit raw JSON Schema.'],
  ['ClearJsonSchema','ai.ClearJsonSchema()','','Removes structured-output configuration.'],
  ['Complete','ai.Complete([messages [, model]])','messages; model','Sends a non-streaming request.','XPAiResponse'],
  ['Stream','ai.Stream([messages,] callback [, model])','messages; callback; model','Sends an SSE request and invokes the callback for each text chunk.','XPAiResponse'],
  ['GetMessages','ai.GetMessages()','','Returns a cloned message array as XPJsonDocument.','XPJsonDocument']
];
for (const [name, syntax, parameters, description, returnType] of aiMethods) add({ name, qualifiedName:`XPAi.${name}`, owner:'XPAi', kind:'function', syntax, parameters, description, ...(returnType ? {returnType}:{}), source:aiSource, section:'Complete API reference' });
for (const [name, syntax, description, returnType] of [
  ['StatusCode','response.StatusCode','HTTP response status code.',undefined],
  ['IsSuccess','response.IsSuccess','True for an HTTP success status.',undefined],
  ['Model','response.Model','Model returned by the provider.',undefined],
  ['Text','response.Text','Assistant text extracted from the response.',undefined],
  ['Content','response.Content','Alias for Text.',undefined],
  ['HasJsonResult','response.HasJsonResult','True when Text contains valid JSON within XPscript JSON limits.',undefined],
  ['ResultJson','response.ResultJson','Parses Text and returns a JSON document.','XPJsonDocument'],
  ['RawJson','response.RawJson','Complete provider JSON response.','XPJsonDocument'],
  ['Usage','response.Usage','Provider usage object.','XPJsonDocument']
]) add({ name, qualifiedName:`XPAiResponse.${name}`, owner:'XPAiResponse', kind:'property', syntax, parameters:'', description, ...(returnType ? {returnType}:{}), source:aiSource, section:'Response' });

// Current native XML DOM. This documentation uses Member|Behavior tables, which the base parser does not consume.
const xmlSource = 'docs/native-xml.md';
const xmlClass = name => add({ name, qualifiedName:name, kind:'class', syntax:`Dim value As ${name}`, parameters:'', description:`XPscript native XML ${name.slice(5)} object.`, source:xmlSource, section:'Native XML' });
for (const name of ['XPXmlDocument','XPXmlNode','XPXmlElement','XPXmlAttribute','XPXmlNodeCollection','XPXmlAttributeCollection','XPXmlValidationResult','XPXmlValidationErrorCollection','XPXmlValidationError']) xmlClass(name);
for (const [name, syntax, parameters, returnType, description] of [
  ['XmlParse','XmlParse(xml)','xml','XPXmlDocument','Parses XML text into an XPXmlDocument.'],
  ['XmlStringify','XmlStringify(documentOrNode)','documentOrNode',undefined,'Serializes an XML document, node or attribute.'],
  ['XmlEscape','XmlEscape(value)','value',undefined,'Escapes standalone XML text.']
]) add({name,qualifiedName:name,kind:'function',syntax,parameters,description,...(returnType?{returnType}:{}),source:xmlSource,section:'Native XML'});

const xmlMembers = {
  XPXmlDocument: [
    ['Root','property','doc.Root','','XPXmlElement'],['DocumentElement','property','doc.DocumentElement','','XPXmlElement'],['HasRoot','property','doc.HasRoot',''],['ChildNodes','property','doc.ChildNodes','','XPXmlNodeCollection'],['Indent','property','doc.Indent','',undefined,true],['OmitXmlDeclaration','property','doc.OmitXmlDeclaration','',undefined,true],
    ['Parse','function','XPXmlDocument.Parse(xml)','xml','XPXmlDocument'],['CreateElement','function','doc.CreateElement(name [, value])','name; value','XPXmlElement'],['CreateTextNode','function','doc.CreateTextNode(value)','value','XPXmlNode'],['CreateCData','function','doc.CreateCData(value)','value','XPXmlNode'],['CreateComment','function','doc.CreateComment(value)','value','XPXmlNode'],['CreateProcessingInstruction','function','doc.CreateProcessingInstruction(target, data)','target; data','XPXmlNode'],['AddRoot','function','doc.AddRoot(name [, value])','name; value','XPXmlElement'],['SetRoot','function','doc.SetRoot(element)','element'],['RemoveRoot','function','doc.RemoveRoot()',''],['Clear','function','doc.Clear()',''],['LoadXml','function','doc.LoadXml(xml)','xml'],['SelectSingleNode','function','doc.SelectSingleNode(xpath)','xpath','XPXmlElement'],['SelectNodes','function','doc.SelectNodes(xpath)','xpath','XPXmlNodeCollection'],['ValidateDTD','function','doc.ValidateDTD(dtd)','dtd','XPXmlValidationResult'],['IsValidDTD','function','doc.IsValidDTD(dtd)','dtd'],['Stringify','function','doc.Stringify()','']
  ],
  XPXmlNode: [
    ['NodeType','property','node.NodeType',''],['Name','property','node.Name',''],['Value','property','node.Value','',undefined,true],['InnerText','property','node.InnerText','',undefined,true],['OuterXml','property','node.OuterXml',''],['Parent','property','node.Parent','','XPXmlElement'],['OwnerDocument','property','node.OwnerDocument','','XPXmlDocument'],['HasParent','property','node.HasParent',''],['HasChildNodes','property','node.HasChildNodes',''],['ChildCount','property','node.ChildCount',''],['ChildNodes','property','node.ChildNodes','','XPXmlNodeCollection'],['FirstChild','property','node.FirstChild','','XPXmlNode'],['LastChild','property','node.LastChild','','XPXmlNode'],['PreviousSibling','property','node.PreviousSibling','','XPXmlNode'],['NextSibling','property','node.NextSibling','','XPXmlNode'],['Clone','function','node.Clone()','','XPXmlNode'],['InsertBefore','function','node.InsertBefore(node)','node','XPXmlNode'],['InsertAfter','function','node.InsertAfter(node)','node','XPXmlNode'],['ReplaceWith','function','node.ReplaceWith(node)','node','XPXmlNode'],['Remove','function','node.Remove()',''],['Delete','function','node.Delete()',''],['Stringify','function','node.Stringify()','']
  ],
  XPXmlElement: [
    ['Name','property','element.Name',''],['Count','property','element.Count',''],['ElementCount','property','element.ElementCount',''],['Elements','property','element.Elements','','XPXmlNodeCollection'],['AttributeCount','property','element.AttributeCount',''],['Attributes','property','element.Attributes','','XPXmlAttributeCollection'],['Rename','function','element.Rename(name)','name'],['AddElement','function','element.AddElement(name [, value])','name; value','XPXmlElement'],['PrependElement','function','element.PrependElement(name [, value])','name; value','XPXmlElement'],['Add','function','element.Add(node)','node'],['AppendChild','function','element.AppendChild(node)','node','XPXmlNode'],['PrependChild','function','element.PrependChild(node)','node','XPXmlNode'],['AddText','function','element.AddText(value)','value'],['AddCData','function','element.AddCData(value)','value'],['AddComment','function','element.AddComment(value)','value'],['GetElement','function','element.GetElement(name)','name','XPXmlElement'],['GetElements','function','element.GetElements(name)','name','XPXmlNodeCollection'],['GetDescendants','function','element.GetDescendants(name)','name','XPXmlNodeCollection'],['RemoveElement','function','element.RemoveElement(name)','name'],['RemoveElements','function','element.RemoveElements(name)','name'],['RemoveChildren','function','element.RemoveChildren()',''],['RemoveAll','function','element.RemoveAll()',''],['SelectSingleNode','function','element.SelectSingleNode(xpath)','xpath','XPXmlElement'],['SelectNodes','function','element.SelectNodes(xpath)','xpath','XPXmlNodeCollection'],['SetAttribute','function','element.SetAttribute(name, value)','name; value'],['GetAttribute','function','element.GetAttribute(name)','name'],['GetAttributeNode','function','element.GetAttributeNode(name)','name','XPXmlAttribute'],['HasAttribute','function','element.HasAttribute(name)','name'],['RemoveAttribute','function','element.RemoveAttribute(name)','name'],['RemoveAllAttributes','function','element.RemoveAllAttributes()','']
  ],
  XPXmlAttribute: [
    ['Name','property','attribute.Name',''],['Value','property','attribute.Value','',undefined,true],['Parent','property','attribute.Parent','','XPXmlElement'],['OwnerElement','property','attribute.OwnerElement','','XPXmlElement'],['IsNamespaceDeclaration','property','attribute.IsNamespaceDeclaration',''],['Remove','function','attribute.Remove()',''],['Delete','function','attribute.Delete()',''],['Stringify','function','attribute.Stringify()','']
  ],
  XPXmlNodeCollection: [['Count','property','nodes.Count',''],['First','property','nodes.First','','XPXmlNode'],['Last','property','nodes.Last','','XPXmlNode'],['Get','function','nodes.Get(index)','index','XPXmlNode']],
  XPXmlAttributeCollection: [['Count','property','attributes.Count',''],['First','property','attributes.First','','XPXmlAttribute'],['Last','property','attributes.Last','','XPXmlAttribute'],['Get','function','attributes.Get(indexOrName)','indexOrName','XPXmlAttribute'],['Has','function','attributes.Has(name)','name']],
  XPXmlValidationResult: [['Valid','property','result.Valid',''],['Errors','property','result.Errors','','XPXmlValidationErrorCollection']],
  XPXmlValidationErrorCollection: [['Count','property','errors.Count',''],['Get','function','errors.Get(index)','index','XPXmlValidationError']],
  XPXmlValidationError: [['Message','property','error.Message',''],['Line','property','error.Line',''],['Column','property','error.Column',''],['Severity','property','error.Severity','']]
};
for (const [owner, members] of Object.entries(xmlMembers)) {
  for (const [name, kind, syntax, parameters, returnType, writable] of members) add({name,qualifiedName:`${owner}.${name}`,owner,kind,syntax,parameters:parameters||'',description:`${owner}.${name}.`,...(returnType?{returnType}:{}),...(writable?{writable:true}:{}),source:xmlSource,section:owner});
}
// XPXmlElement is also an XPXmlNode. Duplicate the inherited public node surface for exact-type completion without inventing another user-facing type.
for (const [name, kind, syntax, parameters, returnType, writable] of xmlMembers.XPXmlNode) {
  if (name === 'Name') continue;
  add({name,qualifiedName:`XPXmlElement.${name}`,owner:'XPXmlElement',kind,syntax:syntax.replace(/^node\./,'element.'),parameters:parameters||'',description:`Inherited XPXmlNode ${name}.`,...(returnType?{returnType}:{}),...(writable?{writable:true}:{}),source:xmlSource,section:'XPXmlNode navigation'});
}

// UIForm accessibility form-level API. Field metadata is documented but the returned field object has no public XPscript type name, so no synthetic public type is introduced here.
const accessibilitySource = 'docs/uiform-accessibility.md';
for (const [name, writable] of [['InitialFocus',true],['FocusedField',false],['ValidationErrors',false],['HasValidationErrors',false],['ValidationSummary',true],['FocusFirstError',true],['AnnounceValidationErrors',true]]) add({name,qualifiedName:`UIForm.${name}`,owner:'UIForm',kind:'property',syntax:`form.${name}`,parameters:'',description:`UIForm accessibility ${name}.`,...(writable?{writable:true}:{}),source:accessibilitySource,section:'Form API'});
for (const [name, syntax, parameters] of [['Focus','form.Focus(name)','name'],['FocusFirst','form.FocusFirst()',''],['FocusFirstInvalid','form.FocusFirstInvalid()',''],['FocusNext','form.FocusNext()',''],['FocusPrevious','form.FocusPrevious()',''],['SetValidationError','form.SetValidationError(name, message)','name; message'],['ClearValidationError','form.ClearValidationError(name)','name'],['GetValidationErrors','form.GetValidationErrors(name)','name'],['Announce','form.Announce(message [, priority])','message; priority']]) add({name,qualifiedName:`UIForm.${name}`,owner:'UIForm',kind:'function',syntax,parameters,description:`UIForm accessibility ${name}.`,source:accessibilitySource,section:'Form API'});

const webViewSource = 'docs/uiform-webview.md';
add({name:'AddWebView',qualifiedName:'UIForm.AddWebView',owner:'UIForm',kind:'function',syntax:'form.AddWebView(name [, label])',parameters:'name; label',description:'Adds an embedded native browser control to a desktop UIForm. The returned field is used through Variant.',source:webViewSource,section:'UIForm WebView'});

const catalog = [...byKey.values()].sort((a,b) => a.qualifiedName.localeCompare(b.qualifiedName));
const header = source.slice(0, jsonStart);
fs.writeFileSync(outFile, `${header}${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Augmented XPscript IntelliSense catalog to ${catalog.length} items.`);
