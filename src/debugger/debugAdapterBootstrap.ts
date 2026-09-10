import * as vscode from 'vscode';
import * as path from 'path';
import { XPScriptDebugAdapter } from './debugAdapter';
import type { XPScriptStartupBreakpoint } from './debugConfiguration';

class XPScriptBootstrapDebugAdapter implements vscode.DebugAdapter {
  private readonly inner = new XPScriptDebugAdapter();
  private readonly emitter = new vscode.EventEmitter<any>();
  private syntheticSequence = -1;

  public readonly onDidSendMessage = this.emitter.event;

  public constructor() {
    this.inner.onDidSendMessage(message => {
      if (message?.type === 'response' && Number(message?.request_seq ?? 0) < 0) return;

      if (message?.type === 'response' && message?.command === 'setBreakpoints' && Array.isArray(message?.body?.breakpoints)) {
        message = {
          ...message,
          body: {
            ...message.body,
            breakpoints: message.body.breakpoints.map((breakpoint: any) => {
              if (!breakpoint || typeof breakpoint !== 'object') return breakpoint;
              const { source: _source, ...rest } = breakpoint;
              return rest;
            })
          }
        };
      }

      this.emitter.fire(message);
    });
  }

  public handleMessage(message: any): void {
    if (message?.type === 'request' && message.command === 'setBreakpoints') {
      const requested = Array.isArray(message.arguments?.breakpoints) ? message.arguments.breakpoints : [];
      const legacyLines = Array.isArray(message.arguments?.lines)
        ? message.arguments.lines.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
        : [];

      if (requested.length === 0 && legacyLines.length > 0) {
        message = {
          ...message,
          arguments: {
            ...message.arguments,
            breakpoints: legacyLines.map((line: number) => ({ line }))
          }
        };
      }
    }

    if (message?.type === 'request' && (message.command === 'launch' || message.command === 'attach')) {
      this.installStartupBreakpoints(
        message.arguments?.startupBreakpoints,
        message.arguments?.startupNonSourceBreakpointNames
      );
    }
    this.inner.handleMessage(message);
  }

  private installStartupBreakpoints(value: unknown, nonSourceValue: unknown): void {
    const startup = Array.isArray(value) ? value as XPScriptStartupBreakpoint[] : [];
    const nonSource = Array.isArray(nonSourceValue)
      ? nonSourceValue.map(item => String(item).trim()).filter(Boolean)
      : [];
    const grouped = new Map<string, XPScriptStartupBreakpoint[]>();

    for (const breakpoint of startup) {
      const source = typeof breakpoint?.source === 'string' ? path.normalize(breakpoint.source) : '';
      const line = Number(breakpoint?.line ?? 0);
      if (!source || line <= 0) continue;
      const key = source.toLowerCase();
      const list = grouped.get(key) ?? [];
      list.push({
        source,
        line,
        condition: breakpoint.condition?.trim() || undefined,
        hitCondition: breakpoint.hitCondition?.trim() || undefined,
        logMessage: breakpoint.logMessage?.trim() || undefined
      });
      grouped.set(key, list);
    }

    if (startup.length > 0) {
      this.emitter.fire({
        seq: 0,
        type: 'event',
        event: 'output',
        body: {
          category: 'console',
          output: `XPscript found ${startup.length} line breakpoint(s).\n`
        }
      });
    }

    if (nonSource.length > 0) {
      this.emitter.fire({
        seq: 0,
        type: 'event',
        event: 'output',
        body: {
          category: 'console',
          output: `XPscript warning: ${nonSource.length} non-line breakpoint(s) will be ignored${nonSource.length ? ` (${nonSource.join(', ')})` : ''}. To create a line breakpoint, click the gutter next to the XPscript line. For a condition, right-click the red breakpoint and choose Edit Breakpoint > Expression.\n`
        }
      });
    }

    for (const breakpoints of grouped.values()) {
      const source = breakpoints[0].source;
      this.inner.handleMessage({
        seq: this.syntheticSequence--,
        type: 'request',
        command: 'setBreakpoints',
        arguments: {
          source: { name: path.basename(source), path: source },
          breakpoints: breakpoints.map(item => ({
            line: item.line,
            condition: item.condition,
            hitCondition: item.hitCondition,
            logMessage: item.logMessage
          }))
        }
      });
    }
  }

  public dispose(): void {
    this.inner.dispose();
    this.emitter.dispose();
  }
}

export class XPScriptDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  public createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new XPScriptBootstrapDebugAdapter());
  }
}
