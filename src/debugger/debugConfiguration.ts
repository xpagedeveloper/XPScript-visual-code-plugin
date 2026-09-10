import * as vscode from 'vscode';
import { snapshotRegisteredBreakpoints } from './breakpointRegistry';

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
}

function snapshotBreakpoints(): XPScriptStartupBreakpoint[] {
  return snapshotRegisteredBreakpoints().map(item => ({ ...item }));
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
      config.startupBreakpoints = snapshotBreakpoints();
    }

    if (config.request === 'attach') {
      config.target ??= 'web';
      config.host ??= '127.0.0.1';
      if (!config.port || config.port < 1 || config.port > 65535) {
        void vscode.window.showErrorMessage('XPscript debugger attach requires a valid TCP port.');
        return undefined;
      }
      config.startupBreakpoints = snapshotBreakpoints();
    }

    return config;
  }
}
