import * as vscode from 'vscode';
import * as path from 'path';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function isXPScriptDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  if (!document || document.isUntitled) return false;
  if (document.languageId === 'xpscript') return true;
  const extension = path.extname(document.uri.fsPath).toLowerCase();
  return extension === '.xps' || extension === '.xpscript';
}

function defaultLaunchFile(): string {
  return JSON.stringify({
    version: '0.2.0',
    configurations: [
      {
        type: 'xpscript',
        request: 'launch',
        name: 'Debug current XPscript file',
        program: '${file}',
        target: 'cli',
        stopOnEntry: false
      }
    ]
  }, null, 2) + '\n';
}

function launchUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, '.vscode', 'launch.json');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function workspaceForDocument(document?: vscode.TextDocument): Promise<vscode.WorkspaceFolder | undefined> {
  if (document) {
    const direct = vscode.workspace.getWorkspaceFolder(document.uri);
    if (direct) return direct;
  }
  if (vscode.workspace.workspaceFolders?.length === 1) return vscode.workspace.workspaceFolders[0];
  return undefined;
}

export async function ensureWorkspaceLaunchConfiguration(document?: vscode.TextDocument): Promise<vscode.Uri | undefined> {
  if (document && !isXPScriptDocument(document)) return undefined;
  const folder = await workspaceForDocument(document);
  if (!folder) return undefined;

  const uri = launchUri(folder);
  if (await exists(uri)) return uri;

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
  await vscode.workspace.fs.writeFile(uri, encoder.encode(defaultLaunchFile()));
  return uri;
}

export async function createOrOpenWorkspaceLaunchConfiguration(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = isXPScriptDocument(editor?.document) ? editor!.document : undefined;
  const folder = await workspaceForDocument(document);
  if (!folder) {
    await vscode.window.showWarningMessage('Open an XPscript file inside a workspace folder before creating launch.json.');
    return;
  }

  const uri = await ensureWorkspaceLaunchConfiguration(document);
  if (!uri) return;
  const launchDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(launchDocument, { preview: false });
}

function findConfigurationsArrayEnd(text: string): { start: number; end: number } | undefined {
  const match = /"configurations"\s*:\s*\[/.exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  let depth = 1;
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1] ?? '';

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index++; }
      continue;
    }
    if (inString) {
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '"') { inString = true; continue; }
    if (char === '[') depth++;
    if (char === ']') {
      depth--;
      if (depth === 0) return { start, end: index };
    }
  }
  return undefined;
}

function sourceProgram(folder: vscode.WorkspaceFolder, document: vscode.TextDocument): string {
  const relative = path.relative(folder.uri.fsPath, document.uri.fsPath).replace(/\\/g, '/');
  if (!relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative)) {
    return '${workspaceFolder}/' + relative;
  }
  return document.uri.fsPath.replace(/\\/g, '/');
}

export async function addCurrentSourceLaunchConfiguration(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!isXPScriptDocument(editor?.document)) {
    await vscode.window.showWarningMessage('Open the XPscript source file you want to add to launch.json.');
    return;
  }

  const document = editor.document;
  const folder = await workspaceForDocument(document);
  if (!folder) {
    await vscode.window.showWarningMessage('The XPscript source file must be inside a workspace folder.');
    return;
  }

  const uri = await ensureWorkspaceLaunchConfiguration(document);
  if (!uri) return;
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = decoder.decode(bytes);
  const program = sourceProgram(folder, document);

  const normalizedText = text.replace(/\\\\/g, '/');
  if (normalizedText.includes(`"program": "${program}"`) || normalizedText.includes(`"program":"${program}"`)) {
    await vscode.window.showInformationMessage(`${path.basename(document.uri.fsPath)} already has a launch configuration.`);
    const launchDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(launchDocument, { preview: false });
    return;
  }

  const array = findConfigurationsArrayEnd(text);
  if (!array) {
    await vscode.window.showErrorMessage('launch.json does not contain a configurations array. Add one or recreate the file with XPscript: Create/Open Workspace launch.json.');
    return;
  }

  const existing = text.slice(array.start, array.end).trim();
  const configuration = {
    type: 'xpscript',
    request: 'launch',
    name: `Debug ${path.basename(document.uri.fsPath)}`,
    program,
    target: 'cli',
    stopOnEntry: false
  };
  const serialized = JSON.stringify(configuration, null, 2)
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');
  const insertion = `${existing ? ',' : ''}\n${serialized}\n  `;
  const updated = text.slice(0, array.end) + insertion + text.slice(array.end);
  await vscode.workspace.fs.writeFile(uri, encoder.encode(updated));

  const launchDocument = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(launchDocument, { preview: false });
  await vscode.window.showInformationMessage(`Added XPscript launch configuration for ${path.basename(document.uri.fsPath)}.`);
}

export function ensureLaunchConfigurationForEditor(editor: vscode.TextEditor | undefined): void {
  if (!isXPScriptDocument(editor?.document)) return;
  void ensureWorkspaceLaunchConfiguration(editor.document).catch(error => {
    console.warn('XPscript could not create workspace launch.json:', error);
  });
}
