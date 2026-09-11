import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { getCompletions, getHover, getSignatureHelp } from './languageService';
import { semanticTokensLegend, XPScriptSemanticTokensProvider } from './semanticTokens';
import { provideSnippetCompletions } from './snippetCompletion';
import { checkForUpdates, scheduleAutomaticUpdateCheck } from './updater';
import { XPScriptDebugConfigurationProvider } from './debugger/debugConfiguration';
import { XPScriptDebugAdapterDescriptorFactory } from './debugger/debugAdapterBootstrap';
import {
  addCurrentSourceLaunchConfiguration,
  createOrOpenWorkspaceLaunchConfiguration,
  ensureLaunchConfigurationForEditor,
  ensureWorkspaceLaunchConfiguration
} from './debugger/launchConfiguration';
import {
  applyBreakpointChanges,
  seedBreakpointRegistry,
  snapshotRegisteredBreakpoints
} from './debugger/breakpointRegistry';

function canStartExecutable(executable: string): Promise<boolean> {
  return new Promise(resolve => execFile(executable, ['--help'], { windowsHide: true, timeout: 5000 }, error => resolve(!error)));
}

async function selectXPScriptExecutable(): Promise<string | undefined> {
  const configuration = vscode.workspace.getConfiguration('xpscript');
  const configured = configuration.get<string>('debugExecutable')?.trim() ?? '';
  const selected = await vscode.window.showOpenDialog({
    title: 'Choose XPscript executable',
    defaultUri: configured ? vscode.Uri.file(configured) : undefined,
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
  await vscode.window.showInformationMessage(`XPscript executable set to: ${executable}`);
  return executable;
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
    return choice === 'Choose xpscript executable' ? selectXPScriptExecutable() : undefined;
  }
  if (await canStartExecutable('xpscript')) return 'xpscript';
  const choice = await vscode.window.showInformationMessage(
    'XPscript was not found in PATH. Choose the XPscript executable once and the extension will remember it.',
    'Choose xpscript executable',
    'Cancel'
  );
  return choice === 'Choose xpscript executable' ? selectXPScriptExecutable() : undefined;
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
  await ensureWorkspaceLaunchConfiguration(editor.document);
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
  if (!started) await vscode.window.showErrorMessage(`Unable to ${noDebug ? 'run' : 'debug'} the current XPscript file.`);
}

function isXPScriptSourceBreakpoint(value: vscode.Breakpoint): value is vscode.SourceBreakpoint {
  if (!(value instanceof vscode.SourceBreakpoint)) return false;
  const extension = path.extname(value.location.uri.fsPath).toLowerCase();
  return extension === '.xps' || extension === '.xpscript';
}

function isGlobalConditionBreakpoint(value: vscode.Breakpoint): value is vscode.FunctionBreakpoint {
  return value instanceof vscode.FunctionBreakpoint;
}

async function syncGlobalConditionBreakpoints(session: vscode.DebugSession): Promise<number> {
  if (session.type !== 'xpscript' || session.configuration.noDebug) return 0;

  const conditions = vscode.debug.breakpoints
    .filter(isGlobalConditionBreakpoint)
    .map(breakpoint => breakpoint.functionName.trim())
    .filter(Boolean);

  try {
    await session.customRequest('setFunctionBreakpoints', {
      breakpoints: conditions.map(name => ({ name }))
    });
  } catch (error) {
    vscode.debug.activeDebugConsole.appendLine(
      `XPscript global condition breakpoint sync failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return conditions.length;
}

async function syncBreakpointsFromRegistry(session: vscode.DebugSession, affectedSources?: Set<string>): Promise<number> {
  if (session.type !== 'xpscript' || session.configuration.noDebug) return 0;

  const grouped = new Map<string, ReturnType<typeof snapshotRegisteredBreakpoints>>();
  for (const breakpoint of snapshotRegisteredBreakpoints()) {
    const key = path.normalize(breakpoint.source).toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(breakpoint);
    grouped.set(key, list);
  }

  const sources = affectedSources ? [...affectedSources] : [...grouped.keys()];
  const program = typeof session.configuration.program === 'string'
    ? path.normalize(session.configuration.program)
    : '';
  if (!affectedSources && program && !sources.includes(program.toLowerCase())) sources.push(program.toLowerCase());

  let imported = 0;
  for (const sourceKey of sources) {
    const current = grouped.get(sourceKey) ?? [];
    const sourcePath = current[0]?.source
      ?? (program && program.toLowerCase() === sourceKey ? program : sourceKey);
    const breakpoints = current.map(breakpoint => ({
      line: breakpoint.line,
      condition: breakpoint.condition,
      hitCondition: breakpoint.hitCondition,
      logMessage: breakpoint.logMessage
    }));
    imported += breakpoints.length;
    try {
      await session.customRequest('setBreakpoints', {
        source: { name: path.basename(sourcePath), path: sourcePath },
        breakpoints
      });
    } catch (error) {
      vscode.debug.activeDebugConsole.appendLine(
        `XPscript breakpoint sync failed for ${path.basename(sourcePath)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return imported;
}

function appendDiagnostic(
  collection: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  line: number,
  column: number,
  message: string,
  severity: vscode.DiagnosticSeverity,
  code?: string
): void {
  const safeLine = Math.max(0, line - 1);
  const safeColumn = Math.max(0, column - 1);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(safeLine, safeColumn, safeLine, safeColumn + 1),
    message.trim(),
    severity
  );
  diagnostic.source = 'XPscript';
  if (code) diagnostic.code = code;
  const existing = collection.get(uri) ?? [];
  if (existing.some(item => item.range.isEqual(diagnostic.range) && item.message === diagnostic.message)) return;
  collection.set(uri, [...existing, diagnostic]);
}

function resolveDiagnosticPath(session: vscode.DebugSession, source: string): string {
  const program = typeof session.configuration.program === 'string' ? session.configuration.program : '';
  if (path.isAbsolute(source)) return source;
  return path.resolve(program ? path.dirname(program) : process.cwd(), source);
}

function parseDiagnosticOutput(
  collection: vscode.DiagnosticCollection,
  session: vscode.DebugSession,
  body: any
): void {
  const output = String(body?.output ?? '');
  if (!output.trim()) return;

  const explicitSource = typeof body?.source?.path === 'string' ? body.source.path : '';
  const explicitLine = Number(body?.line ?? 0);
  if (explicitSource && explicitLine > 0 && (body?.category === 'stderr' || /\berror\b/i.test(output))) {
    appendDiagnostic(
      collection,
      vscode.Uri.file(explicitSource),
      explicitLine,
      Number(body?.column ?? 1),
      output,
      /\bwarning\b/i.test(output) ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
    );
  }

  const structured = /(?:^|\r?\n)\s*file\s*:\s*(.+?)\r?\n\s*line\s*:\s*(\d+)\r?\n\s*(?:position|column)\s*:\s*(\d+)\r?\n\s*description\s*:\s*(.+?)(?=\r?\n\s*(?:file\s*:|$)|$)/gim;
  for (const match of output.matchAll(structured)) {
    const description = match[4].trim();
    const codeMatch = /^([A-Za-z]+\d+)\s*:\s*(.*)$/.exec(description);
    appendDiagnostic(
      collection,
      vscode.Uri.file(resolveDiagnosticPath(session, match[1].trim())),
      Number(match[2]),
      Number(match[3]),
      codeMatch?.[2] ?? description,
      /\bwarning\b/i.test(description) ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
      codeMatch?.[1]
    );
  }

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = /^(.*\.(?:xps|xpscript))\((\d+)(?:,(\d+))?\)\s*:\s*(?:(error|warning)\s*)?([A-Za-z]+\d+)?\s*:?\s*(.+)$/i.exec(line);
    if (match) {
      appendDiagnostic(
        collection,
        vscode.Uri.file(resolveDiagnosticPath(session, match[1])),
        Number(match[2]),
        Number(match[3] ?? 1),
        match[6],
        (match[4] ?? '').toLowerCase() === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
        match[5] || undefined
      );
      continue;
    }

    match = /^(.*\.(?:xps|xpscript)):(\d+)(?::(\d+))?\s*[:\-]?\s*(?:(error|warning)\s*)?(.+)$/i.exec(line);
    if (match) {
      appendDiagnostic(
        collection,
        vscode.Uri.file(resolveDiagnosticPath(session, match[1])),
        Number(match[2]),
        Number(match[3] ?? 1),
        match[5],
        (match[4] ?? '').toLowerCase() === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'xpscript' };
  const diagnostics = vscode.languages.createDiagnosticCollection('xpscript');
  const programOutput = vscode.window.createOutputChannel('XPscript');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  status.command = 'xpscript.quickActions';
  status.tooltip = 'XPscript run, debug and settings';

  seedBreakpointRegistry(vscode.debug.breakpoints);

  const updateStatus = () => {
    const editor = vscode.window.activeTextEditor;
    const xp = editor?.document.languageId === 'xpscript';
    if (!xp) {
      status.hide();
      return;
    }
    const session = vscode.debug.activeDebugSession;
    if (session?.type === 'xpscript') {
      status.text = session.configuration.noDebug ? '$(play) XPscript: Running' : '$(debug-alt) XPscript: Debugging';
    } else {
      status.text = '$(code) XPscript: Ready';
    }
    status.show();
  };

  const refresh = vscode.commands.registerCommand('xpscript.refreshApiIndex', async () => {
    await vscode.window.showInformationMessage('XPscript IntelliSense catalog is generated from the XPscript documentation during build. Rebuild the extension to refresh it.');
  });
  const checkUpdates = vscode.commands.registerCommand('xpscript.checkForUpdates', async () => checkForUpdates(context, true));
  const selectExecutable = vscode.commands.registerCommand('xpscript.selectExecutable', async () => selectXPScriptExecutable());
  const openSettings = vscode.commands.registerCommand('xpscript.openSettings', async () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xpagedeveloper.xpscript'));
  const debugCurrentFile = vscode.commands.registerCommand('xpscript.debugCurrentFile', async () => startCurrentFile(false));
  const runCurrentFile = vscode.commands.registerCommand('xpscript.runCurrentFile', async () => startCurrentFile(true));
  const createLaunch = vscode.commands.registerCommand('xpscript.createLaunchConfiguration', createOrOpenWorkspaceLaunchConfiguration);
  const addSourceLaunch = vscode.commands.registerCommand('xpscript.addSourceLaunchConfiguration', addCurrentSourceLaunchConfiguration);
  const quickActions = vscode.commands.registerCommand('xpscript.quickActions', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: '$(debug-alt) Debug Current File', command: 'xpscript.debugCurrentFile' },
      { label: '$(play) Run Current File', command: 'xpscript.runCurrentFile' },
      { label: '$(json) Create/Open Workspace launch.json', command: 'xpscript.createLaunchConfiguration' },
      { label: '$(add) Add Launch Config for Current File', command: 'xpscript.addSourceLaunchConfiguration' },
      { label: '$(file-binary) Select XPscript Executable', command: 'xpscript.selectExecutable' },
      { label: '$(gear) XPscript Settings', command: 'xpscript.openSettings' }
    ], { placeHolder: 'XPscript' });
    if (pick) await vscode.commands.executeCommand(pick.command);
  });

  const completions = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: getCompletions }, '.', '(', ',', ' ');
  const snippetCompletions = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: provideSnippetCompletions }, '.');
  const hover = vscode.languages.registerHoverProvider(selector, { provideHover: getHover });
  const signatures = vscode.languages.registerSignatureHelpProvider(selector, { provideSignatureHelp: getSignatureHelp }, '(', ',');
  const semanticTokens = vscode.languages.registerDocumentSemanticTokensProvider(selector, new XPScriptSemanticTokensProvider(), semanticTokensLegend);
  const debugConfiguration = vscode.debug.registerDebugConfigurationProvider('xpscript', new XPScriptDebugConfigurationProvider());
  const debugAdapter = vscode.debug.registerDebugAdapterDescriptorFactory('xpscript', new XPScriptDebugAdapterDescriptorFactory());

  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('xpscript', {
    createDebugAdapterTracker(session) {
      return {
        onDidSendMessage(message: any) {
          if (message?.type === 'event' && message?.event === 'output') {
            parseDiagnosticOutput(diagnostics, session, message.body);
          }
        }
      };
    }
  });

  const activeEditor = vscode.window.onDidChangeActiveTextEditor(editor => {
    updateStatus();
    ensureLaunchConfigurationForEditor(editor);
  });
  const openedDocument = vscode.workspace.onDidOpenTextDocument(document => {
    void ensureWorkspaceLaunchConfiguration(document).catch(error => {
      console.warn('XPscript could not create workspace launch.json:', error);
    });
  });
  const startSession = vscode.debug.onDidStartDebugSession(session => {
    if (session.type !== 'xpscript') return;
    diagnostics.clear();
    programOutput.clear();
    updateStatus();
    void syncBreakpointsFromRegistry(session);
    void syncGlobalConditionBreakpoints(session);
  });
  const stopSession = vscode.debug.onDidTerminateDebugSession(session => {
    if (session.type === 'xpscript') updateStatus();
  });
  const changedBreakpoints = vscode.debug.onDidChangeBreakpoints(event => {
    applyBreakpointChanges(event);

    const session = vscode.debug.activeDebugSession;
    if (!session || session.type !== 'xpscript' || session.configuration.noDebug) return;
    const affected = new Set<string>();
    let globalConditionsChanged = false;
    for (const breakpoint of [...event.added, ...event.changed, ...event.removed]) {
      if (isXPScriptSourceBreakpoint(breakpoint)) affected.add(path.normalize(breakpoint.location.uri.fsPath).toLowerCase());
      if (isGlobalConditionBreakpoint(breakpoint)) globalConditionsChanged = true;
    }
    if (affected.size > 0) void syncBreakpointsFromRegistry(session, affected);
    if (globalConditionsChanged) void syncGlobalConditionBreakpoints(session);
  });
  const customEvent = vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
    if (event.session.type !== 'xpscript') return;
    if (event.event === 'stopped') {
      status.text = '$(debug-pause) XPscript: Paused';
      status.show();
      return;
    }
    if (event.event === 'xpscriptProgramOutput') {
      const output = String(event.body?.output ?? '');
      if (output) programOutput.append(output);
    }
  });

  context.subscriptions.push(
    diagnostics,
    programOutput,
    status,
    refresh,
    checkUpdates,
    selectExecutable,
    openSettings,
    debugCurrentFile,
    runCurrentFile,
    createLaunch,
    addSourceLaunch,
    quickActions,
    completions,
    snippetCompletions,
    hover,
    signatures,
    semanticTokens,
    debugConfiguration,
    debugAdapter,
    tracker,
    activeEditor,
    openedDocument,
    startSession,
    stopSession,
    changedBreakpoints,
    customEvent
  );

  updateStatus();
  ensureLaunchConfigurationForEditor(vscode.window.activeTextEditor);
  scheduleAutomaticUpdateCheck(context);
}

export function deactivate(): void {}
