import * as vscode from 'vscode';
import { getCompletions, getHover, getSignatureHelp } from './languageService';
import { semanticTokensLegend, XPScriptSemanticTokensProvider } from './semanticTokens';
import { checkForUpdates, scheduleAutomaticUpdateCheck } from './updater';
import { XPScriptDebugConfigurationProvider } from './debugger/debugConfiguration';
import { XPScriptDebugAdapterDescriptorFactory } from './debugger/debugAdapter';

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'xpscript' };

  const refresh = vscode.commands.registerCommand('xpscript.refreshApiIndex', async () => {
    await vscode.window.showInformationMessage('XPscript IntelliSense catalog is generated from the XPscript documentation during build. Rebuild the extension to refresh it.');
  });

  const checkUpdates = vscode.commands.registerCommand('xpscript.checkForUpdates', async () => {
    await checkForUpdates(context, true);
  });

  const completions = vscode.languages.registerCompletionItemProvider(
    selector,
    { provideCompletionItems: getCompletions },
    '.', '(', ',', ' '
  );

  const hover = vscode.languages.registerHoverProvider(selector, { provideHover: getHover });

  const signatures = vscode.languages.registerSignatureHelpProvider(
    selector,
    { provideSignatureHelp: getSignatureHelp },
    '(', ','
  );

  const semanticTokens = vscode.languages.registerDocumentSemanticTokensProvider(
    selector,
    new XPScriptSemanticTokensProvider(),
    semanticTokensLegend
  );

  const debugConfiguration = vscode.debug.registerDebugConfigurationProvider(
    'xpscript',
    new XPScriptDebugConfigurationProvider()
  );

  const debugAdapter = vscode.debug.registerDebugAdapterDescriptorFactory(
    'xpscript',
    new XPScriptDebugAdapterDescriptorFactory()
  );

  context.subscriptions.push(
    refresh,
    checkUpdates,
    completions,
    hover,
    signatures,
    semanticTokens,
    debugConfiguration,
    debugAdapter
  );

  scheduleAutomaticUpdateCheck(context);
}

export function deactivate(): void {}
