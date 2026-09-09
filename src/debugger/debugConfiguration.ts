import * as vscode from 'vscode';

export interface XPScriptDebugConfiguration extends vscode.DebugConfiguration {
  type: 'xpscript';
  request: 'launch' | 'attach';
  program?: string;
  target?: 'cli' | 'desktop' | 'web' | 'wasm';
  host?: string;
  port?: number;
  token?: string;
  stopOnEntry?: boolean;
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

    if (config.request === 'launch' && !config.program) {
      void vscode.window.showErrorMessage('XPscript debugger requires a program for launch requests.');
      return undefined;
    }

    if (config.request === 'attach' && !config.target) {
      config.target = 'web';
    }

    return config;
  }
}
