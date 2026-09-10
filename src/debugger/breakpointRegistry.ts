import * as vscode from 'vscode';
import * as path from 'path';

export interface RegisteredXPScriptBreakpoint {
  source: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

const breakpoints = new Map<string, RegisteredXPScriptBreakpoint>();

type SourceBreakpointLike = vscode.Breakpoint & {
  location: vscode.Location;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
};

export function isXPScriptSourceBreakpoint(value: vscode.Breakpoint): value is SourceBreakpointLike {
  const candidate = value as Partial<SourceBreakpointLike>;
  const uri = candidate.location?.uri;
  const range = candidate.location?.range;
  if (!uri || !range || typeof uri.fsPath !== 'string') return false;
  const extension = path.extname(uri.fsPath).toLowerCase();
  return extension === '.xps' || extension === '.xpscript';
}

function keyFor(source: string, line: number): string {
  return `${path.normalize(source).toLowerCase()}|${line}`;
}

function fromVSCode(breakpoint: SourceBreakpointLike): RegisteredXPScriptBreakpoint {
  const source = path.normalize(breakpoint.location.uri.fsPath);
  return {
    source,
    line: breakpoint.location.range.start.line + 1,
    condition: breakpoint.condition?.trim() || undefined,
    hitCondition: breakpoint.hitCondition?.trim() || undefined,
    logMessage: breakpoint.logMessage?.trim() || undefined
  };
}

export function seedBreakpointRegistry(values: readonly vscode.Breakpoint[]): void {
  for (const breakpoint of values) {
    if (!isXPScriptSourceBreakpoint(breakpoint)) continue;
    const item = fromVSCode(breakpoint);
    breakpoints.set(keyFor(item.source, item.line), item);
  }
}

export function applyBreakpointChanges(event: vscode.BreakpointsChangeEvent): void {
  for (const breakpoint of event.removed) {
    if (!isXPScriptSourceBreakpoint(breakpoint)) continue;
    const item = fromVSCode(breakpoint);
    breakpoints.delete(keyFor(item.source, item.line));
  }

  for (const breakpoint of [...event.added, ...event.changed]) {
    if (!isXPScriptSourceBreakpoint(breakpoint)) continue;
    const item = fromVSCode(breakpoint);
    breakpoints.set(keyFor(item.source, item.line), item);
  }
}

export function snapshotRegisteredBreakpoints(): RegisteredXPScriptBreakpoint[] {
  return [...breakpoints.values()].map(item => ({ ...item }));
}

export function registeredBreakpointCount(): number {
  return breakpoints.size;
}
