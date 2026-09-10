import * as vscode from 'vscode';
import * as path from 'path';

export type XPScriptTarget = 'cli' | 'desktop' | 'web' | 'wasm';

const wasmMarker = /^\s*\[\s*Platform\s*:\s*browser-wasm\s*\]/im;
const webRouteMarker = /^\s*\[\s*(?:Get|Post|Put|Patch|Delete|Head|Options|Route)(?:\s*\([^\]]*\))?\s*\]/im;
const webRuntimeUsage = /\b(?:Request|Response|RequestScope)\s*\./i;
const webServerUsage = /\b(?:WebServer|XPScriptWebServer)\b/i;
const uiFormUsage = /\b(?:New\s+UIForm\b|As\s+UIForm\b|UIForm\s*\()/i;

export function detectXPScriptTarget(source: string): XPScriptTarget {
  // Explicit platform markers always win over heuristic API usage.
  if (wasmMarker.test(source)) return 'wasm';
  if (webRouteMarker.test(source) || webRuntimeUsage.test(source) || webServerUsage.test(source)) return 'web';
  if (uiFormUsage.test(source)) return 'desktop';
  return 'cli';
}

function isXPScriptDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  if (!document || document.isUntitled) return false;
  if (document.languageId === 'xpscript') return true;
  const extension = path.extname(document.uri.fsPath).toLowerCase();
  return extension === '.xps' || extension === '.xpscript';
}

export async function detectTargetForProgram(program: string | undefined): Promise<XPScriptTarget> {
  const editor = vscode.window.activeTextEditor;
  if (!program || program === '${file}') {
    return isXPScriptDocument(editor?.document) ? detectXPScriptTarget(editor.document.getText()) : 'cli';
  }

  const normalizedProgram = path.normalize(program);
  if (isXPScriptDocument(editor?.document) && path.normalize(editor.document.uri.fsPath) === normalizedProgram) {
    return detectXPScriptTarget(editor.document.getText());
  }

  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(normalizedProgram));
    return detectXPScriptTarget(document.getText());
  } catch {
    return 'cli';
  }
}
