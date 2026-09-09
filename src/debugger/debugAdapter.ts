import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { XPScriptRuntimeClient, RuntimeStoppedEvent, RuntimeMessage } from './runtimeClient';

interface XPScriptDebugConfig extends vscode.DebugConfiguration {
  program?: string;
  target?: 'cli' | 'desktop' | 'web' | 'wasm';
  host?: string;
  port?: number;
  token?: string;
  stopOnEntry?: boolean;
  executable?: string;
  args?: string[];
}

export class XPScriptDebugAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<any>();
  private sequence = 1;
  private client: XPScriptRuntimeClient | undefined;
  private process: ChildProcess | undefined;
  private currentSource = '';
  private currentLine = 1;
  private config: XPScriptDebugConfig | undefined;
  private heldEntryStop = false;

  public readonly onDidSendMessage = this.emitter.event;

  public handleMessage(message: any): void {
    void this.handleRequest(message).catch(error => {
      this.respond(message, undefined, false, error instanceof Error ? error.message : String(error));
    });
  }

  public dispose(): void {
    this.client?.dispose();
    this.process?.kill();
    this.emitter.dispose();
  }

  private async handleRequest(request: any): Promise<void> {
    switch (request.command) {
      case 'initialize':
        this.respond(request, {
          supportsConfigurationDoneRequest: true,
          supportsConditionalBreakpoints: false,
          supportsEvaluateForHovers: false,
          supportsStepBack: false,
          supportsTerminateRequest: true
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
        const breakpoints = (request.arguments?.breakpoints ?? []) as Array<{ line: number }>;
        this.client?.setBreakpoints(source, breakpoints.map(item => item.line));
        this.respond(request, {
          breakpoints: breakpoints.map(item => ({ verified: true, line: item.line, source: request.arguments?.source }))
        });
        return;
      }
      case 'configurationDone':
        this.respond(request);
        if (this.heldEntryStop) {
          this.heldEntryStop = false;
          this.client?.continue();
        }
        return;
      case 'threads':
        this.respond(request, { threads: [{ id: 1, name: 'XPscript main' }] });
        return;
      case 'stackTrace':
        this.respond(request, {
          stackFrames: [{
            id: 1,
            name: 'XPscript',
            line: this.currentLine,
            column: 1,
            source: this.currentSource ? { name: this.fileName(this.currentSource), path: this.currentSource } : undefined
          }],
          totalFrames: 1
        });
        return;
      case 'scopes':
        this.respond(request, {
          scopes: [
            { name: 'Locals', variablesReference: 1000, expensive: false },
            { name: 'Runtime', variablesReference: 1001, expensive: false }
          ]
        });
        return;
      case 'variables': {
        const reference = request.arguments?.variablesReference;
        const variables = reference === 1001
          ? [
              { name: 'Source', value: this.currentSource || '<unknown>', variablesReference: 0 },
              { name: 'Line', value: String(this.currentLine), variablesReference: 0 },
              { name: 'Target', value: this.config?.target ?? 'cli', variablesReference: 0 }
            ]
          : [];
        this.respond(request, { variables });
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
        this.event('terminated');
        return;
      default:
        this.respond(request);
    }
  }

  private async launch(config: XPScriptDebugConfig): Promise<void> {
    this.config = config;
    if (!config.program) throw new Error('XPscript debug launch requires a program.');
    if (config.target === 'web' || config.target === 'wasm')
      throw new Error(`Use attach debugging for XPscript ${config.target} targets.`);

    const port = config.port ?? await this.findPort();
    const token = config.token ?? randomBytes(24).toString('hex');
    const executable = config.executable || vscode.workspace.getConfiguration('xpscript').get<string>('debugExecutable') || 'xpscript';
    const args = ['run', config.program, ...(config.args ?? [])];
    const env = {
      ...process.env,
      XPSCRIPT_DEBUG_PORT: String(port),
      XPSCRIPT_DEBUG_TOKEN: token,
      XPSCRIPT_DEBUG_STOP_ON_ENTRY: '1'
    };

    this.process = spawn(executable, args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.process.stdout?.on('data', data => this.event('output', { category: 'stdout', output: data.toString() }));
    this.process.stderr?.on('data', data => this.event('output', { category: 'stderr', output: data.toString() }));
    this.process.on('exit', code => {
      this.event('output', { category: 'console', output: `XPscript process exited with code ${code ?? 0}.\n` });
      this.event('terminated');
    });

    await this.connect(config.host ?? '127.0.0.1', port, token);
  }

  private async attach(config: XPScriptDebugConfig): Promise<void> {
    this.config = config;
    if (!config.port) throw new Error('XPscript attach requires a port.');
    await this.connect(config.host ?? '127.0.0.1', config.port, config.token ?? '');
  }

  private async connect(host: string, port: number, token: string): Promise<void> {
    const client = new XPScriptRuntimeClient(token);
    client.onEvent(event => {
      if (event.type === 'stopped') {
        this.handleStopped(event as RuntimeStoppedEvent);
        return;
      }
      if (event.type === 'error') {
        const runtimeError = event as RuntimeMessage;
        this.event('output', { category: 'stderr', output: String(runtimeError.message ?? 'Debugger runtime error') + '\n' });
      }
    });
    await client.connect(host, port);
    this.client = client;
  }

  private handleStopped(event: RuntimeStoppedEvent): void {
    this.currentSource = event.source;
    this.currentLine = event.line;
    if (event.reason === 'entry' && this.config?.request === 'launch' && this.config.stopOnEntry === false) {
      this.heldEntryStop = true;
      return;
    }
    this.event('stopped', { reason: event.reason, threadId: event.threadId || 1, allThreadsStopped: true });
  }

  private respond(request: any, body?: any, success = true, message?: string): void {
    this.emitter.fire({
      seq: this.sequence++,
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success,
      message,
      body
    });
  }

  private event(event: string, body?: any): void {
    this.emitter.fire({ seq: this.sequence++, type: 'event', event, body });
  }

  private fileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  private async findPort(): Promise<number> {
    const net = await import('net');
    return new Promise<number>((resolve, reject) => {
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
