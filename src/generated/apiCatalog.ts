// Generated from XPscript docs. CI regenerates this file from the XPscript repository.
export type ApiItemKind = 'keyword' | 'function' | 'property' | 'class';
export interface ApiItem {
  name: string;
  qualifiedName: string;
  owner?: string;
  kind: ApiItemKind;
  syntax: string;
  parameters: string;
  description: string;
  returnType?: string;
  writable?: boolean;
  source: string;
  section: string;
}

export const apiCatalog: ApiItem[] = [
  { name:'Get', qualifiedName:'HttpClient.Get', owner:'HttpClient', kind:'function', syntax:'http.Get(url)', parameters:'url', description:'Sends a GET request and returns HttpResponse.', returnType:'HttpResponse', source:'docs/api-reference.md', section:'Native HTTP client' },
  { name:'Timeout', qualifiedName:'HttpClient.Timeout', owner:'HttpClient', kind:'property', syntax:'http.Timeout = seconds', parameters:'seconds', description:'Gets or sets total request timeout.', writable:true, source:'docs/api-reference.md', section:'Native HTTP client' },
  { name:'StatusCode', qualifiedName:'HttpResponse.StatusCode', owner:'HttpResponse', kind:'property', syntax:'response.StatusCode', parameters:'', description:'HTTP status code.', source:'docs/api-reference.md', section:'HTTP response' },
  { name:'Body', qualifiedName:'HttpResponse.Body', owner:'HttpResponse', kind:'property', syntax:'response.Body', parameters:'', description:'Response body as text.', source:'docs/api-reference.md', section:'HTTP response' },
  { name:'Json', qualifiedName:'HttpResponse.Json', owner:'HttpResponse', kind:'function', syntax:'response.Json()', parameters:'', description:'Parses the body and returns JsonDocument.', returnType:'JsonDocument', source:'docs/api-reference.md', section:'HTTP response' },
  { name:'FileInfo', qualifiedName:'FileInfo', kind:'function', syntax:'FileInfo(path)', parameters:'path', description:'Returns filesystem metadata.', returnType:'FileInfo', source:'docs/file-io-reference.md', section:'File metadata' },
  ...['Name','FullPath','Extension','Length','Created','Modified','Accessed','IsFile','IsDirectory','IsLink','Attributes'].map(name => ({ name, qualifiedName:`FileInfo.${name}`, owner:'FileInfo', kind:'property' as const, syntax:`fileInfo.${name}`, parameters:'', description:`FileInfo ${name} property.`, source:'docs/file-io-reference.md', section:'FileInfo' })),
  { name:'CStr', qualifiedName:'CStr', kind:'function', syntax:'CStr(value)', parameters:'value', description:'Converts to String.', source:'docs/commands.md', section:'Conversion and inspection' },
  { name:'Len', qualifiedName:'Len', kind:'function', syntax:'Len(text)', parameters:'text', description:'Returns string length.', source:'docs/commands.md', section:'Strings' },
  { name:'If', qualifiedName:'If', kind:'keyword', syntax:'If condition Then ... End If', parameters:'condition', description:'Conditional execution.', source:'docs/commands.md', section:'Language and procedures' },
  { name:'Dim', qualifiedName:'Dim', kind:'keyword', syntax:'Dim name As Type', parameters:'name, type', description:'Declares a variable.', source:'docs/commands.md', section:'Language and procedures' }
];
