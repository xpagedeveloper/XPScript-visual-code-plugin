import * as vscode from 'vscode';
import { apiCatalog, ApiItem } from './generated/apiCatalog';
import { parameterHelp, ApiParameterHelp } from './generated/parameterHelp';

const XPSCRIPT_REPO_BLOB_BASE = 'https://github.com/xpagedeveloper/XPscript/blob/main/';

const byOwner = new Map<string, ApiItem[]>();
const byName = new Map<string, ApiItem[]>();
const globalItems: ApiItem[] = [];
const topLevelNotesClasses = [
  'NotesSession', 'NotesDBDirectory', 'NotesDatabase', 'NotesView', 'NotesViewColumn',
  'NotesViewEntry', 'NotesViewEntryCollection', 'NotesViewNavigator', 'NotesDocumentCollection',
  'NotesDocument', 'NotesItem', 'NotesRichTextItem', 'NotesRichTextNavigator', 'NotesRichTextRange',
  'NotesRichTextStyle', 'NotesRichTextParagraphStyle', 'NotesRichTextTab', 'NotesRichTextSection',
  'NotesRichTextTable', 'NotesRichTextDocLink', 'NotesEmbeddedObject', 'NotesName', 'NotesDateTime',
  'NotesStream', 'NotesMIMEEntity', 'NotesMIMEHeader', 'NotesAgent', 'NotesAgentResult',
  'NotesNoteCollection', 'NotesRichtext'
];
for (const item of apiCatalog) {
  if (item.owner) {
    const key = item.owner.toLowerCase();
    const values = byOwner.get(key);
    if (values) values.push(item); else byOwner.set(key, [item]);
  } else {
    globalItems.push(item);
  }
  const nameKey = item.name.toLowerCase();
  const named = byName.get(nameKey);
  if (named) named.push(item); else byName.set(nameKey, [item]);
}
for (const name of topLevelNotesClasses) {
  if (byName.has(name.toLowerCase())) continue;
  const item: ApiItem = {
    name, qualifiedName: name, kind: 'class', syntax: `Dim value As ${name}`, parameters: '',
    description: `Public XPscript ${name} object.`, source: 'docs/notes-c-api.md', section: 'Native Notes/Domino'
  };
  globalItems.push(item);
  byName.set(name.toLowerCase(), [item]);
}

interface DocumentAnalysis {
  version: number;
  types: Map<string, string>;
}

const documentAnalysisCache = new Map<string, DocumentAnalysis>();
const completionCache = new Map<string, vscode.CompletionItem[]>();

function parameterDetailsFor(item: ApiItem): ApiParameterHelp[] {
  return parameterHelp[item.qualifiedName.toLowerCase()] ?? [];
}

function sourceUrl(source: string): string | undefined {
  const clean = source.trim().replace(/^\.\//, '');
  if (!clean) return undefined;
  if (/^https?:\/\//i.test(clean)) return clean;
  return encodeURI(`${XPSCRIPT_REPO_BLOB_BASE}${clean}`);
}

function rawParameterNames(item: ApiItem): string[] {
  if (!item.parameters || item.parameters.trim().toLowerCase() === 'none') return [];
  return item.parameters.split(';').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

function memberFor(owner: string, name: string): ApiItem | undefined {
  return (byOwner.get(owner.toLowerCase()) ?? []).find(x => x.name.toLowerCase() === name.toLowerCase());
}

function resolveExpressionType(expression: string, types: Map<string, string>): string | undefined {
  const parts = expression.trim().split('.').map(x => x.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const firstName = parts[0].replace(/\(.*$/, '');
  let currentType = types.get(firstName.toLowerCase());
  if (!currentType && byOwner.has(firstName.toLowerCase())) currentType = firstName;
  if (!currentType) currentType = (byName.get(firstName.toLowerCase()) ?? []).find(x => !x.owner && x.returnType)?.returnType;
  if (!currentType) return undefined;
  for (const rawPart of parts.slice(1)) {
    const memberName = rawPart.replace(/\(.*$/, '');
    const member = memberFor(currentType, memberName);
    if (!member?.returnType) return undefined;
    currentType = member.returnType;
  }
  return currentType;
}

export function resolveVariableTypes(text: string): Map<string, string> {
  const types = new Map<string, string>();
  const explicit = /^\s*Dim\s+(\w+)\s+As\s+(?:New\s+)?([A-Za-z_]\w*)/gim;
  for (const match of text.matchAll(explicit)) types.set(match[1].toLowerCase(), match[2]);

  const assignments = /^\s*(?:Set\s+)?(\w+)\s*=\s*([A-Za-z_]\w*)\s*\(/gim;
  for (const match of text.matchAll(assignments)) {
    const fn = (byName.get(match[2].toLowerCase()) ?? []).find(x => !x.owner && x.returnType);
    if (fn?.returnType) types.set(match[1].toLowerCase(), fn.returnType);
  }

  const memberAssignments = [...text.matchAll(/^\s*(?:Set\s+)?(\w+)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*(?:\([^\r\n]*?\))?)*)\s*$/gim)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of memberAssignments) {
      const variable = match[1].toLowerCase();
      if (types.has(variable)) continue;
      const resolved = resolveExpressionType(match[2], types);
      if (resolved) {
        types.set(variable, resolved);
        changed = true;
      }
    }
  }
  return types;
}

function typesFor(document: vscode.TextDocument): Map<string, string> {
  const key = document.uri.toString();
  const cached = documentAnalysisCache.get(key);
  if (cached?.version === document.version) return cached.types;
  const types = resolveVariableTypes(document.getText());
  documentAnalysisCache.set(key, { version: document.version, types });
  return types;
}

function completionKind(item: ApiItem): vscode.CompletionItemKind {
  switch (item.kind) {
    case 'property': return vscode.CompletionItemKind.Property;
    case 'class': return vscode.CompletionItemKind.Class;
    case 'keyword': return vscode.CompletionItemKind.Keyword;
    default: return vscode.CompletionItemKind.Function;
  }
}

function parameterLabel(parameter: ApiParameterHelp): string {
  let label = `\`${parameter.name}\``;
  if (parameter.type) label += ` As \`${parameter.type}\``;
  if (!parameter.required) label += ' *(optional)*';
  return label;
}

function markdown(item: ApiItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  const details = parameterDetailsFor(item);
  const rawParameters = rawParameterNames(item);
  md.appendCodeblock(item.syntax, 'xpscript');
  if (item.description) md.appendMarkdown(`\n${item.description}`);
  if (details.length > 0) {
    md.appendMarkdown('\n\n### Parameters');
    for (const parameter of details) {
      const defaultText = parameter.default !== undefined ? ` Default: \`${String(parameter.default)}\`.` : '';
      md.appendMarkdown(`\n\n- ${parameterLabel(parameter)}: ${parameter.description || 'No separate parameter description is documented.'}${defaultText}`);
    }
  } else if (rawParameters.length > 0) {
    md.appendMarkdown('\n\n### Parameters');
    for (const parameter of rawParameters) md.appendMarkdown(`\n\n- \`${parameter}\`: Parameter documented by the XPscript API source. See the source link below for usage details.`);
  } else if (item.kind === 'function') {
    md.appendMarkdown('\n\n### Parameters\n\nThis function has no documented parameters.');
  } else if (item.kind === 'class') {
    md.appendMarkdown('\n\n### Parameters\n\nNo constructor parameters are documented for this object.');
  }
  if (item.returnType) md.appendMarkdown(`\n\nReturns: \`${item.returnType}\``);
  if (item.writable) md.appendMarkdown('\n\nRead/Write');
  const url = sourceUrl(item.source);
  if (url) md.appendMarkdown(`\n\nSource: [\`${item.source}\`](${url} "Open XPscript source documentation")`);
  else md.appendMarkdown(`\n\nSource: \`${item.source}\``);
  return md;
}

export function completionFor(item: ApiItem): vscode.CompletionItem {
  const result = new vscode.CompletionItem(item.name, completionKind(item));
  result.detail = item.syntax;
  result.documentation = markdown(item);
  if (item.kind === 'function' && item.syntax.includes('(')) {
    const open = item.syntax.indexOf('(');
    const close = item.syntax.lastIndexOf(')');
    const args = close > open ? item.syntax.slice(open + 1, close) : '';
    const required = args.replace(/\[|\]/g, '').split(',').map(x => x.trim()).filter(Boolean);
    if (required.length > 0) {
      const placeholders = required.map((arg, i) => `\${${i + 1}:${arg.replace(/\s+/g, ' ')}}`).join(', ');
      result.insertText = new vscode.SnippetString(`${item.name}(${placeholders})`);
    }
  }
  return result;
}

function completionsFor(owner?: string): vscode.CompletionItem[] {
  const key = owner?.toLowerCase() ?? '';
  const cached = completionCache.get(key);
  if (cached) return cached;
  const items = (owner ? byOwner.get(key) ?? [] : globalItems).map(completionFor);
  completionCache.set(key, items);
  return items;
}

export function getCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  const member = prefix.match(/([A-Za-z_]\w*(?:\([^()]*\))?(?:\.[A-Za-z_]\w*(?:\([^()]*\))?)*)\.([A-Za-z_]\w*)?$/);
  if (member) {
    const owner = resolveExpressionType(member[1], typesFor(document)) ?? member[1];
    return completionsFor(owner);
  }
  return completionsFor();
}

export function findItemAt(document: vscode.TextDocument, position: vscode.Position): ApiItem | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!range) return undefined;
  const word = document.getText(range);
  const linePrefix = document.lineAt(position.line).text.slice(0, range.start.character);
  const receiverMatch = linePrefix.match(/([A-Za-z_]\w*(?:\([^()]*\))?(?:\.[A-Za-z_]\w*(?:\([^()]*\))?)*)\.\s*$/);
  if (receiverMatch) {
    const owner = resolveExpressionType(receiverMatch[1], typesFor(document)) ?? receiverMatch[1];
    return memberFor(owner, word);
  }
  return (byName.get(word.toLowerCase()) ?? []).find(x => !x.owner) ?? byName.get(word.toLowerCase())?.[0];
}

export function getHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const item = findItemAt(document, position);
  return item ? new vscode.Hover(markdown(item)) : undefined;
}

export function getSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.SignatureHelp | undefined {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const match = text.match(/(?:(\b[A-Za-z_]\w*(?:\([^()]*\))?(?:\.[A-Za-z_]\w*(?:\([^()]*\))?)*)\.)?([A-Za-z_]\w*)\(([^()]*)$/);
  if (!match) return undefined;
  const receiver = match[1];
  const name = match[2];
  let item: ApiItem | undefined;
  if (receiver) {
    const owner = resolveExpressionType(receiver, typesFor(document)) ?? receiver;
    item = memberFor(owner, name);
  } else {
    item = (byName.get(name.toLowerCase()) ?? []).find(x => !x.owner);
  }
  if (!item || item.kind !== 'function') return undefined;

  const sig = new vscode.SignatureInformation(item.syntax, markdown(item));
  const details = parameterDetailsFor(item);
  if (details.length > 0) {
    sig.parameters = details.map(parameter => {
      const label = parameter.type ? `${parameter.name} As ${parameter.type}` : parameter.name;
      const docs = new vscode.MarkdownString();
      docs.appendMarkdown(parameter.description || 'No separate parameter description is documented.');
      if (!parameter.required) docs.appendMarkdown('\n\nOptional.');
      if (parameter.default !== undefined) docs.appendMarkdown(`\n\nDefault: \`${String(parameter.default)}\`.`);
      return new vscode.ParameterInformation(label, docs);
    });
  } else {
    sig.parameters = rawParameterNames(item).map(p => new vscode.ParameterInformation(p, 'Parameter documented by the XPscript API source.'));
  }
  const help = new vscode.SignatureHelp();
  help.signatures = [sig];
  help.activeSignature = 0;
  help.activeParameter = Math.min((match[3].match(/,/g) ?? []).length, Math.max(0, sig.parameters.length - 1));
  return help;
}
