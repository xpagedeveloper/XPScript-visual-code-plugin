import * as net from 'net';

const SUPPORTED_PROTOCOL = 5;

export interface RuntimeStackFrame {
  id: number;
  name: string;
  source: string;
  line: number;
  column: number;
}

export interface RuntimeValueChange {
  Sequence: number;
  Name: string;
  OldValue: string;
  NewValue: string;
  Source: string;
  Line: number;
  Procedure: string;
  TimestampUtc: string;
}

export interface RuntimeStoppedEvent {
  type: 'stopped';
  reason: 'entry' | 'breakpoint' | 'step' | 'pause' | 'data breakpoint' | 'exception';
  source: string;
  line: number;
  threadId: number;
  frames?: RuntimeStackFrame[];
  dataId?: string;
  exceptionId?: string;
  breakMode?: string;
  description?: string;
}

export interface RuntimeValueHistoryEvent {
  type: 'valueHistory';
  name: string;
  items: RuntimeValueChange[];
}

export interface RuntimeDebuggerVariable {
  name: string;
  value: string;
}

export interface RuntimeDebuggerVariablesEvent {
  type: 'debuggerVariables';
  items: RuntimeDebuggerVariable[];
}

export interface RuntimeMessage {
  type: string;
  [key: string]: unknown;
}

export type RuntimeEvent = RuntimeStoppedEvent | RuntimeValueHistoryEvent | RuntimeDebuggerVariablesEvent | RuntimeMessage;

export class XPScriptRuntimeClient {
  private socket: net.Socket | undefined;
  private buffer = '';
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly historyWaiters: Array<(event: RuntimeValueHistoryEvent) => void> = [];
  private readonly debuggerVariableWaiters: Array<(event: RuntimeDebuggerVariablesEvent) => void> = [];
  private helloResolve: (() => void) | undefined;
  private helloReject: ((error: Error) => void) | undefined;

  constructor(private readonly token = '') {}

  public onEvent(listener: (event: RuntimeEvent) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public async connect(host: string, port: number, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.connectOnce(host, port, Math.max(250, deadline - Date.now()));
        return;
      } catch (error) {
        lastError = error;
        this.dispose();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Unable to connect to XPscript debugger at ${host}:${port}.`);
  }

  public setBreakpoints(source: string, lines: number[]): void {
    const normalized = source.replace(/\\/g, '/');
    const runtimeSource = normalized.slice(normalized.lastIndexOf('/') + 1);
    this.send({ command: 'setBreakpoints', source: runtimeSource, lines });
  }
  public setDataBreakpoints(names: string[]): void { this.send({ command: 'setDataBreakpoints', names }); }
  public setExceptionBreakpoints(filters: string[]): void { this.send({ command: 'setExceptionBreakpoints', filters }); }

  public async valueHistory(name = ''): Promise<RuntimeValueHistoryEvent> {
    return new Promise<RuntimeValueHistoryEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('XPscript value history request timed out.')), 3000);
      this.historyWaiters.push(event => { clearTimeout(timer); resolve(event); });
      try { this.send({ command: 'valueHistory', name }); }
      catch (error) { clearTimeout(timer); this.historyWaiters.pop(); reject(error); }
    });
  }

  public async debuggerVariables(): Promise<RuntimeDebuggerVariablesEvent> {
    return new Promise<RuntimeDebuggerVariablesEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('XPscript debugger variables request timed out.')), 3000);
      this.debuggerVariableWaiters.push(event => { clearTimeout(timer); resolve(event); });
      try { this.send({ command: 'debuggerVariables' }); }
      catch (error) { clearTimeout(timer); this.debuggerVariableWaiters.pop(); reject(error); }
    });
  }

  public continue(): void { this.send({ command: 'continue' }); }
  public next(): void { this.send({ command: 'next' }); }
  public stepIn(): void { this.send({ command: 'stepIn' }); }
  public stepOut(): void { this.send({ command: 'stepOut' }); }
  public pause(): void { this.send({ command: 'pause' }); }
  public disconnect(): void {
    try { this.send({ command: 'disconnect' }); } catch { }
    this.dispose();
  }

  public dispose(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private async connectOnce(host: string, port: number, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`XPscript debugger handshake timed out at ${host}:${port}.`));
      }, timeoutMs);
      const fail = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error); };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        this.socket = socket;
        this.helloResolve = () => { clearTimeout(timer); resolve(); };
        this.helloReject = error => { clearTimeout(timer); reject(error); };
        socket.on('error', error => this.emit({ type: 'error', message: error.message }));
        socket.on('data', chunk => this.handleData(chunk.toString('utf8')));
        socket.on('close', () => {
          if (this.socket === socket) this.socket = undefined;
          this.emit({ type: 'disconnected' });
        });
      });
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.socket) throw new Error('XPscript debugger runtime is not connected.');
    const payload = this.token.length > 0 ? { ...message, token: this.token } : message;
    this.socket.write(JSON.stringify(payload) + '\n', 'utf8');
  }

  private handleData(data: string): void {
    this.buffer += data;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line) as RuntimeEvent;
        if (event.type === 'hello') {
          const protocol = Number((event as RuntimeMessage).protocol ?? 0);
          if (protocol !== SUPPORTED_PROTOCOL) {
            const error = new Error(`XPscript debugger protocol mismatch. Extension supports ${SUPPORTED_PROTOCOL}, runtime reported ${protocol}.`);
            this.helloReject?.(error);
            this.helloResolve = undefined;
            this.helloReject = undefined;
            this.dispose();
            continue;
          }
          this.helloResolve?.();
          this.helloResolve = undefined;
          this.helloReject = undefined;
        }
        if (event.type === 'valueHistory' && this.historyWaiters.length > 0)
          this.historyWaiters.shift()?.(event as RuntimeValueHistoryEvent);
        if (event.type === 'debuggerVariables' && this.debuggerVariableWaiters.length > 0)
          this.debuggerVariableWaiters.shift()?.(event as RuntimeDebuggerVariablesEvent);
        this.emit(event);
      } catch {
        // Ignore malformed runtime frames and keep the debug channel alive.
      }
    }
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
