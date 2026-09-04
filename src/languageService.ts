import * as vscode from 'vscode';
import { apiCatalog, ApiItem } from './generated/apiCatalog';

const byOwner = new Map<string, ApiItem[]>();
const byName = new Map<string, ApiItem[]>();
for (const item of apiCatalog) {
  if (item.owner) {
    const key = item.owner.toLowerCase();
    byOwner.set(key, [...(byOwner.get(key) ?? []), item]);
  }
  const nameKey = item.name.toLowerCase();
  byName.set(nameKey, [...(byName.get(nameKey) ?? []), item]);
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

  const memberAssignments = /^\s*(?:Set\s+)?(\w+)\s*=\s*(\w+)\.([A-Za-z_]\w*)\s*\(/gim;
  for (const match of text.matchAll(memberAssignments)) {
    const receiverType = types.get(match[2].toLowerCase());
    if (!receiverType) continue;
    const member = (byOwner.get(receiverType.toLowerCase()) ?? []).find(x => x.name.toLowerCase() === match[3].toLowerCase());
    if (member?.returnType) types.set(match[1].toLowerCase(), member.returnType);
  }
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

function markdown(item: ApiItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(item.syntax, 'xpscript');
  if (item.description) md.appendMarkdown(`\n${item.description}`);
  if (item.parameters && item.parameters.toLowerCase() !== 'none') md.appendMarkdown(`\n\nParameters: ${item.parameters}`);
  if (item.returnType) md.appendMarkdown(`\n\nReturns: \`${item.returnType}\``);
  md.appendMarkdown(`\n\nSource: \`${item.source}\``);
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

export function getCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  const member = prefix.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/);
  if (member) {
    const receiver = member[1];
    const types = resolveVariableTypes(document.getText());
    const owner = types.get(receiver.toLowerCase()) ?? receiver;
    return (byOwner.get(owner.toLowerCase()) ?? []).map(completionFor);
  }
  return apiCatalog.filter(x => !x.owner).map(completionFor);
}

export function findItemAt(document: vscode.TextDocument, position: vscode.Position): ApiItem | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!range) return undefined;
  const word = document.getText(range);
  const linePrefix = document.lineAt(position.line).text.slice(0, range.start.character);
  const receiverMatch = linePrefix.match(/([A-Za-z_]\w*)\.\s*$/);
  if (receiverMatch) {
    const types = resolveVariableTypes(document.getText());
    const owner = types.get(receiverMatch[1].toLowerCase()) ?? receiverMatch[1];
    return (byOwner.get(owner.toLowerCase()) ?? []).find(x => x.name.toLowerCase() === word.toLowerCase());
  }
  return (byName.get(word.toLowerCase()) ?? []).find(x => !x.owner) ?? byName.get(word.toLowerCase())?.[0];
}

export function getHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const item = findItemAt(document, position);
  return item ? new vscode.Hover(markdown(item)) : undefined;
}

export function getSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.SignatureHelp | undefined {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const match = text.match(/(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\(([^()]*)$/);
  if (!match) return undefined;
  const receiver = match[1];
  const name = match[2];
  let item: ApiItem | undefined;
  if (receiver) {
    const types = resolveVariableTypes(document.getText());
    const owner = types.get(receiver.toLowerCase()) ?? receiver;
    item = (byOwner.get(owner.toLowerCase()) ?? []).find(x => x.name.toLowerCase() === name.toLowerCase());
  } else {
    item = (byName.get(name.toLowerCase()) ?? []).find(x => !x.owner);
  }
  if (!item || item.kind !== 'function') return undefined;

  const sig = new vscode.SignatureInformation(item.syntax, markdown(item));
  const rawParams = item.parameters && item.parameters.toLowerCase() !== 'none'
    ? item.parameters.split(';').flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean)
    : [];
  sig.parameters = rawParams.map(p => new vscode.ParameterInformation(p));
  const help = new vscode.SignatureHelp();
  help.signatures = [sig];
  help.activeSignature = 0;
  help.activeParameter = Math.min((match[3].match(/,/g) ?? []).length, Math.max(0, sig.parameters.length - 1));
  return help;
}
