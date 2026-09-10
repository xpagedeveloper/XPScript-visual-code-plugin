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

      // Keep VS Code's original source identity. The inner adapter used to replace
      // source.name with "file.xps:line", which can detach a persisted source
      // breakpoint from the editor document on the next debug session.
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
      const source = String(message.arguments?.source?.path ?? message.arguments?.source?.name ?? '');
      const breakpoints = Array.isArray(message.arguments?.breakpoints) ? message.arguments.breakpoints : [];
      const details = breakpoints.map((breakpoint: any) => {
        const line = Number(breakpoint?.line ?? 0);
        const condition = String(breakpoint?.condition ?? '').trim();
        const hitCondition = String(breakpoint?.hitCondition ?? '').trim();
        const logMessage = String(breakpoint?.logMessage ?? '').trim();
        const suffix = condition
          ? ` condition=${condition}`
          : hitCondition
            ? ` hitCount=${hitCondition}`
            : logMessage
              ? ` logMessage=${logMessage}`
              : '';
        return `${line}${suffix}`;
      }).join(', ');

      this.emitter.fire({
        seq: 0,
        type: 'event',
        event: 'output',
        body: {
          category: 'console',
          output: `XPscript DAP setBreakpoints ${path.basename(source) || '<unknown>'}: ${details || '<empty>'}.\n`
        }
      });
    }

    if (message?.type === 'request' && (message.command === 'launch' || message.command === 'attach')) {
      this.installStartupBreakpoints(message.arguments?.startupBreakpoints);
    }
    this.inner.handleMessage(message);
  }

  private installStartupBreakpoints(value: unknown): void {
    const startup = Array.isArray(value) ? value as XPScriptStartupBreakpoint[] : [];
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

    this.emitter.fire({
      seq: 0,
      type: 'event',
      event: 'output',
      body: {
        category: 'console',
        output: `XPscript startup breakpoint snapshot: ${startup.length}.\n`
      }
    });

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
