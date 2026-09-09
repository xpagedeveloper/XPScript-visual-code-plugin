import * as vscode from 'vscode';
import { getCompletions, getHover, getSignatureHelp } from './languageService';
import { semanticTokensLegend, XPScriptSemanticTokensProvider } from './semanticTokens';
import { checkForUpdates, scheduleAutomaticUpdateCheck } from './updater';
import { XPScriptDebugConfigurationProvider } from './debugger/debugConfiguration';
import { XPScriptDebugAdapterDescriptorFactory } from './debugger/debugAdapter';

async function startCurrentFile(noDebug: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'xpscript') {
    await vscode.window.showErrorMessage('Open an XPscript source file before starting it.');
    return;
  }

  if (editor.document.isUntitled) {
    await vscode.window.showErrorMessage('Save the XPscript source file before starting it.');
    return;
  }

  if (editor.document.isDirty) {
    await editor.document.save();
  }

  const configuration: vscode.DebugConfiguration = {
    type: 'xpscript',
    request: 'launch',
    name: noDebug ? 'Run current XPscript file' : 'Debug current XPscript file',
    program: editor.document.uri.fsPath,
    target: 'cli',
    stopOnEntry: false,
    noDebug
  };

  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const started = await vscode.debug.startDebugging(folder, configuration, { noDebug });
  if (!started) {
    await vscode.window.showErrorMessage(`Unable to ${noDebug ? 'run' : 'debug'} the current XPscript file.`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'xpscript' };

  const refresh = vscode.commands.registerCommand('xpscript.refreshApiIndex', async () => {
    await vscode.window.showInformationMessage('XPscript IntelliSense catalog is generated from the XPscript documentation during build. Rebuild the extension to refresh it.');
  });

  const checkUpdates = vscode.commands.registerCommand('xpscript.checkForUpdates', async () => {
    await checkForUpdates(context, true);
  });

  const debugCurrentFile = vscode.commands.registerCommand('xpscript.debugCurrentFile', async () => {
    await startCurrentFile(false);
  });

  const runCurrentFile = vscode.commands.registerCommand('xpscript.runCurrentFile', async () => {
    await startCurrentFile(true);
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
    debugCurrentFile,
    runCurrentFile,
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
