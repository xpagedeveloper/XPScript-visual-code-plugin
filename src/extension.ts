import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const refresh = vscode.commands.registerCommand('xpscript.refreshApiIndex', async () => {
    await vscode.window.showInformationMessage('XPscript API index refresh requested.');
  });

  const completions = vscode.languages.registerCompletionItemProvider(
    { language: 'xpscript' },
    {
      provideCompletionItems() {
        return [];
      }
    },
    '.'
  );

  context.subscriptions.push(refresh, completions);
}

export function deactivate(): void {}
