import * as vscode from 'vscode';
import { seedBreakpointRegistry, snapshotRegisteredBreakpoints } from './breakpointRegistry';

export interface XPScriptStartupBreakpoint {
  source: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface XPScriptDebugConfiguration extends vscode.DebugConfiguration {
  type: 'xpscript';
  request: 'launch' | 'attach';
  program?: string;
  target?: 'cli' | 'desktop' | 'web' | 'wasm';
  host?: string;
  port?: number;
  token?: string;
  stopOnEntry?: boolean;
  executable?: string;
  args?: string[];
  startupBreakpoints?: XPScriptStartupBreakpoint[];
  startupVSCodeBreakpointCount?: number;
  startupBreakpointShapes?: string[];
  startupNonSourceBreakpointNames?: string[];
}

function describeBreakpoint(value: vscode.Breakpoint, index: number): string {
  const candidate = value as any;
  const location = candidate?.location;
  const uri = location?.uri;
  const range = location?.range;
  const fsPath = typeof uri?.fsPath === 'string' ? uri.fsPath : '';
  const uriText = typeof uri?.toString === 'function' ? String(uri.toString()) : '';
  const line = Number.isFinite(Number(range?.start?.line)) ? Number(range.start.line) + 1 : 0;
  const constructorName = String(candidate?.constructor?.name ?? typeof value);
  const condition = typeof candidate?.condition === 'string' ? candidate.condition : '';
  const hitCondition = typeof candidate?.hitCondition === 'string' ? candidate.hitCondition : '';
  const logMessage = typeof candidate?.logMessage === 'string' ? candidate.logMessage : '';
  const functionName = typeof candidate?.functionName === 'string' ? candidate.functionName : '';

  return `#${index + 1} ctor=${constructorName} enabled=${candidate?.enabled !== false} location=${Boolean(location)} fsPath=${fsPath || '<none>'} uri=${uriText || '<none>'} line=${line || '<none>'} functionName=${functionName || '<none>'} condition=${condition || '<none>'} hitCondition=${hitCondition || '<none>'} logMessage=${logMessage || '<none>'}`;
}

function snapshotBreakpoints(): XPScriptStartupBreakpoint[] {
  seedBreakpointRegistry(vscode.debug.breakpoints);
  return snapshotRegisteredBreakpoints().map(item => ({ ...item }));
}

function captureBreakpointDebugInfo(config: XPScriptDebugConfiguration): void {
  config.startupVSCodeBreakpointCount = vscode.debug.breakpoints.length;
  config.startupBreakpointShapes = vscode.debug.breakpoints.map((breakpoint, index) => describeBreakpoint(breakpoint, index));
  config.startupNonSourceBreakpointNames = vscode.debug.breakpoints
    .map(breakpoint => breakpoint as any)
    .filter(candidate => !candidate?.location)
    .map(candidate => String(candidate?.functionName ?? '').trim())
    .filter(Boolean);
  config.startupBreakpoints = snapshotBreakpoints();
}

export class XPScriptDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: XPScriptDebugConfiguration
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId === 'xpscript') {
        config.type = 'xpscript';
        config.name = 'Debug XPscript';
        config.request = 'launch';
        config.program = '${file}';
        config.target = 'cli';
        config.stopOnEntry = false;
      }
    }

    if (config.request === 'launch') {
      if (!config.program) {
        void vscode.window.showErrorMessage('XPscript debugger requires a program for launch requests.');
        return undefined;
      }
      config.target ??= 'cli';
      if (config.target === 'web' || config.target === 'wasm') {
        void vscode.window.showErrorMessage(`XPscript ${config.target} debugging currently uses an attach configuration.`);
        return undefined;
      }
      captureBreakpointDebugInfo(config);
    }

    if (config.request === 'attach') {
      config.target ??= 'web';
      config.host ??= '127.0.0.1';
      if (!config.port || config.port < 1 || config.port > 65535) {
        void vscode.window.showErrorMessage('XPscript debugger attach requires a valid TCP port.');
        return undefined;
      }
      captureBreakpointDebugInfo(config);
    }

    return config;
  }
}
