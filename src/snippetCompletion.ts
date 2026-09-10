import * as vscode from 'vscode';
import { snippetCatalog } from './generated/snippetCatalog';

const triggerPattern = /(?:^|\s)(snippet\.)([A-Za-z0-9_-]*)$/i;

export function provideSnippetCompletions(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const match = triggerPattern.exec(linePrefix);
  if (!match) return [];

  const triggerStart = position.character - match[1].length - match[2].length;
  const replaceRange = new vscode.Range(
    new vscode.Position(position.line, triggerStart),
    position
  );

  return snippetCatalog.map(snippet => {
    const item = new vscode.CompletionItem(snippet.name, vscode.CompletionItemKind.Snippet);
    item.detail = 'XPscript snippet';
    item.documentation = new vscode.MarkdownString(snippet.description);
    item.insertText = new vscode.SnippetString(snippet.body);
    item.range = replaceRange;
    item.filterText = `snippet.${snippet.name}`;
    item.sortText = snippet.name.toLowerCase();
    return item;
  });
}
