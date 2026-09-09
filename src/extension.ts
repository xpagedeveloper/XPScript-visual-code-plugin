import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { getCompletions, getHover, getSignatureHelp } from './languageService';
import { semanticTokensLegend, XPScriptSemanticTokensProvider } from './semanticTokens';
import { checkForUpdates, scheduleAutomaticUpdateCheck } from './updater';
import { XPScriptDebugConfigurationProvider } from './debugger/debugConfiguration';
import { XPScriptDebugAdapterDescriptorFactory } from './debugger/debugAdapter';

function canStartExecutable(executable: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile(executable, ['--help'], { windowsHide: true, timeout: 5000 }, error => resolve(!error));
  });
}

async function resolveXPScriptExecutable(): Promise<string | undefined> {
  const configuration = vscode.workspace.getConfiguration('xpscript');
  const configured = configuration.get<string>('debugExecutable')?.trim() ?? '';

  if (configured) {
    if (await canStartExecutable(configured)) return configured;
    const choice = await vscode.window.showWarningMessage(
      `The configured XPscript executable could not be started: ${configured}`,
      'Choose xpscript executable',
      'Cancel'
    );
    if (choice !== 'Choose xpscript executable') return undefined;
  } else if (await canStartExecutable('xpscript')) {
    return 'xpscript';
  }

  if (!configured) {
    const choice = await vscode.window.showInformationMessage(
      'XPscript was not found in PATH. Choose the XPscript executable once and the extension will remember it.',
      'Choose xpscript executable',
      'Cancel'
    );
    if (choice !== 'Choose xpscript executable') return undefined;
  }

  const selected = await vscode.window.showOpenDialog({
    title: 'Choose XPscript executable',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Use XPscript executable',
    filters: process.platform === 'win32' ? { 'XPscript executable': ['exe'] } : undefined
  });
  const executable = selected?.[0]?.fsPath;
  if (!executable) return undefined;

  if (!(await canStartExecutable(executable))) {
    await vscode.window.showErrorMessage(`The selected file could not be started as XPscript: ${executable}`);
    return undefined;
  }

  await configuration.update('debugExecutable', executable, vscode.ConfigurationTarget.Global);
  return executable;
}

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

  if (editor.document.isDirty && !(await editor.document.save())) {
    await vscode.window.showErrorMessage('The XPscript source file could not be saved.');
    return;
  }

  const executable = await resolveXPScriptExecutable();
  if (!executable) return;

  const configuration: vscode.DebugConfiguration = {
    type: 'xpscript',
    request: 'launch',
    name: noDebug ? 'Run current XPscript file' : 'Debug current XPscript file',
    program: editor.document.uri.fsPath,
    target: 'cli',
    stopOnEntry: false,
    executable,
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
