import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import * as path from 'path';
import {
  XPScriptRuntimeClient,
  RuntimeStoppedEvent,
  RuntimeMessage,
  RuntimeStackFrame,
  RuntimeValueChange,
  RuntimeBreakpoint
} from './runtimeClient';

interface XPScriptDebugConfig extends vscode.DebugConfiguration {
  program?: string;
  target?: 'cli' | 'desktop' | 'web' | 'wasm';
  host?: string;
  port?: number;
  token?: string;
  stopOnEntry?: boolean;
  executable?: string;
  args?: string[];
  noDebug?: boolean;
  startupNonSourceBreakpointNames?: string[];
}

interface PendingBreakpointSet {
  source: string;
  breakpoints: RuntimeBreakpoint[];
}

export class XPScriptDebugAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<any>();
  private sequence = 1;
  private client: XPScriptRuntimeClient | undefined;
  private process: ChildProcess | undefined;
  private currentSource = '';
  private currentLine = 1;
  private currentFrames: RuntimeStackFrame[] = [];
  private currentException: RuntimeStoppedEvent | undefined;
  private config: XPScriptDebugConfig | undefined;
  private heldEntryStop = false;
  private terminated = false;
  private processExited = false;
  private socketDisconnected = false;
  private terminationTimer: NodeJS.Timeout | undefined;
  private nextVariableReference = 2000;

  private readonly historyReferences = new Map<number, string>();
  private readonly currentValues = new Map<string, RuntimeValueChange>();
  private readonly debuggerVariableNames = new Set<string>();
  private readonly breakpointSets = new Map<string, PendingBreakpointSet>();
  private globalConditionBreakpoints: string[] = [];

  public readonly onDidSendMessage = this.emitter.event;

  public handleMessage(message: any): void {
    void this.handleRequest(message).catch(error =>
      this.respond(message, undefined, false, error instanceof Error ? error.message : String(error)));
  }

  public dispose(): void {
    if (this.terminationTimer) clearTimeout(this.terminationTimer);
    this.client?.dispose();
    this.process?.kill();
    this.emitter.dispose();
  }

  private async handleRequest(request: any): Promise<void> {
    switch (request.command) {
      case 'initialize':
        this.respond(request, {
          supportsConfigurationDoneRequest: true,
          supportsFunctionBreakpoints: true,
          supportsConditionalBreakpoints: true,
          supportsHitConditionalBreakpoints: true,
          supportsLogPoints: true,
          supportsEvaluateForHovers: true,
          supportsStepBack: false,
          supportsTerminateRequest: true,
          supportsDataBreakpoints: true,
          supportsExceptionInfoRequest: true,
          exceptionBreakpointFilters: [
            { filter: 'uncaught', label: 'Uncaught XPscript exceptions', default: true },
            { filter: 'all', label: 'All XPscript exceptions', default: false }
          ]
        });
        this.event('initialized');
        return;

      case 'launch':
        await this.launch(request.arguments as XPScriptDebugConfig);
        this.respond(request);
        return;

      case 'attach':
        await this.attach(request.arguments as XPScriptDebugConfig);
        this.respond(request);
        return;

      case 'setBreakpoints': {
        const source = request.arguments?.source?.path ?? '';
        const requested = (request.arguments?.breakpoints ?? []) as Array<{
          line: number;
          condition?: string;
          hitCondition?: string;
          logMessage?: string;
        }>;

        const executableLines = this.executableLines(source);
        const runtimeBreakpoints: RuntimeBreakpoint[] = requested.map(item => ({
          line: this.resolveBreakpointLine(item.line, executableLines),
          condition: String(item.condition ?? '').trim() || undefined,
          hitCondition: String(item.hitCondition ?? '').trim() || undefined,
          logMessage: String(item.logMessage ?? '').trim() || undefined
        }));

        this.breakpointSets.set(this.breakpointSourceKey(source), { source, breakpoints: runtimeBreakpoints });
        this.client?.setBreakpoints(source, runtimeBreakpoints);

        this.respond(request, {
          breakpoints: requested.map((item, index) => {
            const line = runtimeBreakpoints[index]?.line || item.line;
            const sourceInfo = request.arguments?.source
              ? { ...request.arguments.source, name: `${this.fileName(source)}:${line}` }
              : undefined;
            return {
              verified: line > 0,
              line,
              source: sourceInfo,
              message: line !== item.line ? `Moved to executable XPscript line ${line}.` : undefined
            };
          })
        });
        return;
      }

      case 'setFunctionBreakpoints': {
        const requested = (request.arguments?.breakpoints ?? []) as Array<{ name?: string }>;
        const conditions = requested
          .map(item => String(item.name ?? '').trim())
          .filter(Boolean);
        this.globalConditionBreakpoints = conditions;
        this.event('output', {
          category: 'console',
          output: `XPscript received ${conditions.length} global condition breakpoint(s)${conditions.length ? ': ' + conditions.join(', ') : ''}.\n`
        });
        this.client?.setGlobalConditionBreakpoints(conditions);
        this.respond(request, {
          breakpoints: requested.map(item => {
            const condition = String(item.name ?? '').trim();
            return {
              verified: Boolean(condition),
              message: condition ? undefined : 'Enter an XPscript condition such as Counter = 10.'
            };
          })
        });
        return;
      }

      case 'setExceptionBreakpoints': {
        const filters = ((request.arguments?.filters ?? []) as string[])
          .filter(value => value === 'all' || value === 'uncaught');
        this.client?.setExceptionBreakpoints(filters);
        this.respond(request);
        return;
      }

      case 'exceptionInfo': {
        const exception = this.currentException;
        this.respond(request, {
          exceptionId: exception?.exceptionId ?? 'XPscript exception',
          description: exception?.description ?? 'XPscript exception',
          breakMode: exception?.breakMode ?? 'unhandled'
        });
        return;
      }

      case 'dataBreakpointInfo': {
        const name = String(request.arguments?.name ?? '').trim();
        await this.refreshCurrentValues();
        const observed = this.currentValues.get(name.toLowerCase());
        if (!name || !observed) {
          this.respond(request, {
            dataId: null,
            description: name ? `${name} is not an observed XPscript value.` : 'No XPscript variable selected.',
            canPersist: false
          });
          return;
        }
        this.respond(request, {
          dataId: observed.Name,
          description: `Break when ${observed.Name} changes`,
          accessTypes: ['write'],
          canPersist: true
        });
        return;
      }

      case 'setDataBreakpoints': {
        const requested = (request.arguments?.breakpoints ?? []) as Array<{ dataId?: string; accessType?: string }>;
        const names = requested
          .filter(item => !item.accessType || item.accessType === 'write')
          .map(item => String(item.dataId ?? '').trim())
          .filter(Boolean);
        this.client?.setDataBreakpoints(names);
        this.respond(request, {
          breakpoints: requested.map(item => ({
            verified: Boolean(item.dataId) && (!item.accessType || item.accessType === 'write'),
            message: item.accessType && item.accessType !== 'write'
              ? 'XPscript currently supports data breakpoints on writes only.'
              : undefined
          }))
        });
        return;
      }

      case 'configurationDone': {
        this.respond(request);
        const configured = [...this.breakpointSets.values()];
        if (configured.length === 0) {
          this.event('output', { category: 'console', output: 'XPscript debugger: no source breakpoints were received from VS Code.\n' });
        } else {
          for (const set of configured) {
            for (const breakpoint of set.breakpoints) {
              const suffix = breakpoint.condition
                ? ` condition=${breakpoint.condition}`
                : breakpoint.hitCondition
                  ? ` hitCount=${breakpoint.hitCondition}`
                  : breakpoint.logMessage
                    ? ` logMessage=${breakpoint.logMessage}`
                    : '';
              this.event('output', {
                category: 'console',
                output: `XPscript configured breakpoint ${this.fileName(set.source)}:${breakpoint.line}${suffix}\n`
              });
            }
          }
        }
        if (this.heldEntryStop) {
          this.heldEntryStop = false;
          this.client?.continue();
        }
        return;
      }

      case 'threads':
        this.respond(request, { threads: [{ id: 1, name: 'XPscript main' }] });
        return;

      case 'stackTrace': {
        const frames = this.currentFrames.length
          ? this.currentFrames
          : [{ id: 1, name: 'XPscript', source: this.currentSource, line: this.currentLine, column: 1 }];
        this.respond(request, {
          stackFrames: frames.map(frame => ({
            id: frame.id,
            name: frame.name,
            line: frame.line,
            column: frame.column || 1,
            source: frame.source
              ? { name: this.fileName(frame.source), path: this.resolveSourcePath(frame.source) }
              : undefined
          })),
          totalFrames: frames.length
        });
        return;
      }

      case 'scopes':
        this.respond(request, {
          scopes: [
            { name: 'Locals', variablesReference: 1000, expensive: false },
            { name: 'Debugger Variables', variablesReference: 1002, expensive: false },
            { name: 'Runtime', variablesReference: 1001, expensive: false }
          ]
        });
        return;

      case 'variables': {
        const reference = request.arguments?.variablesReference;
        if (reference === 1000) {
          await this.refreshCurrentValues();
          await this.refreshDebuggerVariableNames();
          const variables = [...this.currentValues.values()]
            .filter(item => !this.debuggerVariableNames.has(item.Name.toLowerCase()))
            .sort((a, b) => a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' }))
            .map(item => ({
              name: item.Name,
              value: item.NewValue,
              type: 'observed scalar',
              variablesReference: this.historyReference(item.Name),
              evaluateName: item.Name
            }));
          this.respond(request, { variables });
          return;
        }

        if (reference === 1002) {
          const response = await this.client?.debuggerVariables();
          const variables = (response?.items ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map(item => ({
              name: item.name,
              value: item.value,
              type: 'Debugger.UpdateVar',
              variablesReference: this.historyReference(item.name),
              evaluateName: item.name
            }));
          this.respond(request, { variables });
          return;
        }

        if (reference === 1001) {
          this.respond(request, {
            variables: [
              { name: 'Source', value: this.currentSource || '<unknown>', variablesReference: 0 },
              { name: 'Line', value: String(this.currentLine), variablesReference: 0 },
              { name: 'Target', value: this.config?.target ?? 'cli', variablesReference: 0 },
              { name: 'Call depth', value: String(this.currentFrames.length || 1), variablesReference: 0 }
            ]
          });
          return;
        }

        const historyName = this.historyReferences.get(reference);
        if (historyName) {
          const response = await this.client?.valueHistory(historyName);
          const items = (response?.items ?? []).slice().reverse();
          this.respond(request, {
            variables: items.map((item, index) => ({
              name: `#${items.length - index} ${this.fileName(item.Source)}:${item.Line}`,
              value: `${item.OldValue} -> ${item.NewValue}`,
              type: item.Procedure,
              variablesReference: 0,
              presentationHint: { kind: 'data', attributes: ['readOnly'] }
            }))
          });
          return;
        }

        this.respond(request, { variables: [] });
        return;
      }

      case 'evaluate': {
        const expression = String(request.arguments?.expression ?? '').trim();
        const history = /^@?history(?:\(([^)]+)\)|\s+(.+))$/i.exec(expression);
        if (history) {
          const name = (history[1] ?? history[2] ?? '').trim();
          const response = await this.client?.valueHistory(name);
          const items = response?.items ?? [];
          const result = items.length === 0
            ? `No recorded value changes for ${name}.`
            : items.slice().reverse()
              .map(item => `${this.fileName(item.Source)}:${item.Line} ${item.Procedure}: ${item.OldValue} -> ${item.NewValue}`)
              .join('\n');
          this.respond(request, { result, variablesReference: 0 });
          return;
        }

        await this.refreshCurrentValues();
        const observed = this.currentValues.get(expression.toLowerCase());
        this.respond(request, {
          result: observed?.NewValue ?? `No observed value for ${expression}. Use history(variable) for tracked changes.`,
          variablesReference: observed ? this.historyReference(observed.Name) : 0
        });
        return;
      }

      case 'continue':
        this.client?.continue();
        this.respond(request, { allThreadsContinued: true });
        return;
      case 'next':
        this.client?.next();
        this.respond(request);
        return;
      case 'stepIn':
        this.client?.stepIn();
        this.respond(request);
        return;
      case 'stepOut':
        this.client?.stepOut();
        this.respond(request);
        return;
      case 'pause':
        this.client?.pause();
        this.respond(request);
        return;

      case 'disconnect':
      case 'terminate':
        this.client?.disconnect();
        this.process?.kill();
        this.respond(request);
        this.terminateOnce();
        return;

      default:
        this.respond(request);
    }
  }

  private async launch(config: XPScriptDebugConfig): Promise<void> {
    this.config = config;
    this.mergeStartupGlobalConditions(config.startupNonSourceBreakpointNames);
    this.processExited = false;
    this.socketDisconnected = false;
    if (!config.program) throw new Error('XPscript launch requires a program.');
    if (config.target === 'web' || config.target === 'wasm')
      throw new Error(`Use attach debugging for XPscript ${config.target} targets.`);

    const executable = config.executable
      || vscode.workspace.getConfiguration('xpscript').get<string>('debugExecutable')
      || 'xpscript';

    if (config.noDebug) {
      this.event('output', { category: 'console', output: `Running ${this.fileName(config.program)} without debugger.\n` });
      await this.spawnProcess(executable, ['run', config.program, ...(config.args ?? [])], process.env);
      return;
    }

    const port = config.port ?? await this.findPort();
    const token = config.token ?? randomBytes(24).toString('hex');
    const args = ['run', config.program, '--debug', ...(config.args ?? [])];
    const env = {
      ...process.env,
      XPSCRIPT_DEBUG_PORT: String(port),
      XPSCRIPT_DEBUG_TOKEN: token,
      XPSCRIPT_DEBUG_STOP_ON_ENTRY: '1'
    };

    this.event('output', {
      category: 'console',
      output: `Starting XPscript debugger protocol v6 on 127.0.0.1:${port}.\n`
    });

    const started = this.spawnProcess(executable, args, env);
    try {
      await Promise.all([started, this.connect(config.host ?? '127.0.0.1', port, token, 60000)]);
    } catch (error) {
      this.process?.kill();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`XPscript started but the debugger could not connect. ${message}`);
    }
  }

  private async spawnProcess(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(executable, args, {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.process = child;
      child.stdout?.on('data', data => {
        const output = data.toString();
        this.event('output', { category: 'stdout', output });
        this.event('xpscriptProgramOutput', { category: 'stdout', output });
      });
      child.stderr?.on('data', data => {
        const output = data.toString();
        this.event('output', { category: 'stderr', output });
        this.event('xpscriptProgramOutput', { category: 'stderr', output });
      });
      child.once('spawn', () => { settled = true; resolve(); });
      child.once('error', error => {
        this.event('output', { category: 'stderr', output: `Unable to start XPscript executable: ${error.message}\n` });
        if (!settled) reject(new Error(`Unable to start XPscript executable: ${error.message}`));
      });
      child.on('exit', code => {
        this.processExited = true;
        this.event('output', { category: 'console', output: `XPscript process exited with code ${code ?? 0}.\n` });
        this.scheduleTerminationAfterDrain();
      });
    });
  }

  private async attach(config: XPScriptDebugConfig): Promise<void> {
    this.config = config;
    this.mergeStartupGlobalConditions(config.startupNonSourceBreakpointNames);
    this.processExited = false;
    this.socketDisconnected = false;
    if (!config.port) throw new Error('XPscript attach requires a port.');
    await this.connect(config.host ?? '127.0.0.1', config.port, config.token ?? '', 10000);
  }

  private async connect(host: string, port: number, token: string, timeoutMs: number): Promise<void> {
    const client = new XPScriptRuntimeClient(token);
    client.onEvent(event => {
      if (event.type === 'stopped') {
        this.handleStopped(event as RuntimeStoppedEvent);
        return;
      }
      if (event.type === 'debugOutput') {
        const output = event as RuntimeMessage;
        const source = String(output.source ?? '');
        const sourcePath = this.resolveSourcePath(source);
        const line = Number(output.line ?? 0);
        const prefix = source && line > 0 ? `${this.fileName(source)}:${line} ` : '';
        this.event('output', {
          category: 'console',
          output: prefix + String(output.output ?? '') + '\n',
          source: source ? { name: this.fileName(source), path: sourcePath } : undefined,
          line: line > 0 ? line : undefined
        });
        void vscode.commands.executeCommand('workbench.debug.action.focusRepl');
        return;
      }
      if (event.type === 'programOutput') {
        const output = event as RuntimeMessage;
        const category = String(output.category ?? 'stdout') === 'stderr' ? 'stderr' : 'stdout';
        const text = String(output.output ?? '') + (output.newLine ? '\n' : '');
        this.event('output', { category, output: text });
        this.event('xpscriptProgramOutput', { category, output: text });
        return;
      }
      if (event.type === 'breakpointDiagnostic') {
        const info = event as RuntimeMessage;
        this.event('output', { category: 'console', output: String(info.message ?? '') + '\n' });
        return;
      }
      if (event.type === 'error') {
        const runtimeError = event as RuntimeMessage;
        this.event('output', { category: 'stderr', output: String(runtimeError.message ?? 'Debugger runtime error') + '\n' });
        return;
      }
      if (event.type === 'complete') {
        this.event('output', { category: 'console', output: 'XPscript debugger runtime completed.\n' });
        return;
      }
      if (event.type === 'disconnected') {
        this.socketDisconnected = true;
        this.scheduleTerminationAfterDrain();
      }
    });

    await client.connect(host, port, timeoutMs);
    this.client = client;
    for (const item of this.breakpointSets.values()) client.setBreakpoints(item.source, item.breakpoints);
    this.event('output', {
      category: 'console',
      output: `XPscript sending ${this.globalConditionBreakpoints.length} global condition breakpoint(s) to runtime${this.globalConditionBreakpoints.length ? ': ' + this.globalConditionBreakpoints.join(', ') : ''}.\n`
    });
    client.setGlobalConditionBreakpoints(this.globalConditionBreakpoints);
  }

  private mergeStartupGlobalConditions(value: unknown): void {
    const startup = Array.isArray(value)
      ? value.map(item => String(item ?? '').trim()).filter(Boolean)
      : [];
    if (startup.length === 0) return;

    const seen = new Set(this.globalConditionBreakpoints.map(item => item.toLowerCase()));
    for (const condition of startup) {
      const key = condition.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      this.globalConditionBreakpoints.push(condition);
    }
  }

  private handleStopped(event: RuntimeStoppedEvent): void {
    this.currentSource = this.resolveSourcePath(event.source);
    this.currentLine = event.line;
    this.currentFrames = (event.frames ?? []).map(frame => ({ ...frame, source: this.resolveSourcePath(frame.source) }));
    this.currentException = event.reason === 'exception'
      ? { ...event, source: this.currentSource, frames: this.currentFrames }
      : undefined;
    this.currentValues.clear();
    this.debuggerVariableNames.clear();
    this.historyReferences.clear();
    this.nextVariableReference = 2000;

    if (event.reason === 'entry' && this.config?.request === 'launch' && this.config.stopOnEntry === false) {
      this.heldEntryStop = true;
      return;
    }

    this.event('stopped', {
      reason: event.reason,
      threadId: event.threadId || 1,
      allThreadsStopped: true,
      description: event.description,
      text: event.description
    });
  }

  private executableLines(source: string): number[] {
    try {
      const fs = require('fs') as typeof import('fs');
      const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
      const result: number[] = [];
      for (let index = 0; index < lines.length; index++) {
        const text = lines[index].trim();
        if (!text || text.startsWith("'") || /^Rem\b/i.test(text)
          || /^(Sub|Function|Property|Class|Type)\b/i.test(text)
          || /^End\s+(Sub|Function|Property|Class|Type)\b/i.test(text)
          || /^(Else|ElseIf|End If|Next|Loop|Wend)$/i.test(text)) continue;
        result.push(index + 1);
      }
      return result;
    } catch { return []; }
  }

  private resolveBreakpointLine(line: number, lines: number[]): number {
    if (lines.length === 0 || lines.includes(line)) return line;
    return lines.find(value => value > line) ?? lines.filter(value => value < line).pop() ?? line;
  }

  private async refreshCurrentValues(): Promise<void> {
    const response = await this.client?.valueHistory('');
    const items = response?.items ?? [];
    this.currentValues.clear();
    for (const item of items) {
      const key = item.Name.toLowerCase();
      const current = this.currentValues.get(key);
      if (!current || item.Sequence > current.Sequence) this.currentValues.set(key, item);
    }
  }

  private async refreshDebuggerVariableNames(): Promise<void> {
    const response = await this.client?.debuggerVariables();
    this.debuggerVariableNames.clear();
    for (const item of response?.items ?? []) this.debuggerVariableNames.add(item.name.toLowerCase());
  }

  private breakpointSourceKey(source: string): string { return this.fileName(source).toLowerCase(); }

  private historyReference(name: string): number {
    for (const [reference, existing] of this.historyReferences)
      if (existing.toLowerCase() === name.toLowerCase()) return reference;
    const reference = this.nextVariableReference++;
    this.historyReferences.set(reference, name);
    return reference;
  }

  private scheduleTerminationAfterDrain(): void {
    if (this.terminated || this.terminationTimer) return;
    if (this.processExited && this.socketDisconnected) { this.terminateOnce(); return; }
    this.terminationTimer = setTimeout(() => {
      this.terminationTimer = undefined;
      this.terminateOnce();
    }, this.processExited ? 750 : 250);
  }

  private terminateOnce(): void {
    if (this.terminated) return;
    if (this.terminationTimer) clearTimeout(this.terminationTimer);
    this.terminationTimer = undefined;
    this.terminated = true;
    this.event('terminated');
  }

  private respond(request: any, body?: any, success = true, message?: string): void {
    this.emitter.fire({ seq: this.sequence++, type: 'response', request_seq: request.seq, command: request.command, success, message, body });
  }

  private event(event: string, body?: any): void { this.emitter.fire({ seq: this.sequence++, type: 'event', event, body }); }

  private fileName(sourcePath: string): string {
    const normalized = sourcePath.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  private resolveSourcePath(sourcePath: string): string {
    if (!sourcePath) return sourcePath;
    if (path.isAbsolute(sourcePath)) return path.normalize(sourcePath);
    const program = this.config?.program;
    if (program) {
      if (this.fileName(program).toLowerCase() === this.fileName(sourcePath).toLowerCase()) return path.normalize(program);
      return path.resolve(path.dirname(program), sourcePath);
    }
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return workspace ? path.resolve(workspace, sourcePath) : sourcePath;
  }

  private async findPort(): Promise<number> {
    const net = await import('net');
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Unable to allocate debugger port.'));
          return;
        }
        const port = address.port;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
  }
}

export class XPScriptDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  public createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new XPScriptDebugAdapter());
  }
}
