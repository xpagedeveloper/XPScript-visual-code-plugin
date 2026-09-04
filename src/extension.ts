import * as vscode from 'vscode';
import { getCompletions, getHover, getSignatureHelp } from './languageService';

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'xpscript' };

  const refresh = vscode.commands.registerCommand('xpscript.refreshApiIndex', async () => {
    await vscode.window.showInformationMessage('XPscript IntelliSense catalog is generated from the XPscript documentation during build. Rebuild the extension to refresh it.');
  });

  const completions = vscode.languages.registerCompletionItemProvider(
    selector,
    { provideCompletionItems: getCompletions },
    '.', '(', ',', ' '
  );

  const hover = vscode.languages.registerHoverProvider(selector, {
    provideHover: getHover
  });

  const signatures = vscode.languages.registerSignatureHelpProvider(
    selector,
    { provideSignatureHelp: getSignatureHelp },
    '(', ','
  );

  context.subscriptions.push(refresh, completions, hover, signatures);
}

export function deactivate(): void {}
