import * as net from 'net';

const SUPPORTED_PROTOCOL = 6;

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

export interface RuntimeValueHistoryEvent { type: 'valueHistory'; name: string; items: RuntimeValueChange[]; }
export interface RuntimeDebuggerVariable { name: string; value: string; }
export interface RuntimeDebuggerVariablesEvent { type: 'debuggerVariables'; items: RuntimeDebuggerVariable[]; }
export interface RuntimeBreakpoint { line: number; condition?: string; hitCondition?: string; logMessage?: string; }
export interface RuntimeMessage { type: string; [key: string]: unknown; }
export type RuntimeEvent = RuntimeStoppedEvent | RuntimeValueHistoryEvent | RuntimeDebuggerVariablesEvent | RuntimeMessage;

type HistoryWaiter = { resolve: (event: RuntimeValueHistoryEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; };
type DebuggerVariableWaiter = { resolve: (event: RuntimeDebuggerVariablesEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; };

export class XPScriptRuntimeClient {
  private socket: net.Socket | undefined;
  private buffer = '';
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly historyWaiters: HistoryWaiter[] = [];
  private readonly debuggerVariableWaiters: DebuggerVariableWaiter[] = [];
  private helloResolve: (() => void) | undefined;
  private helloReject: ((error: Error) => void) | undefined;
  private connectedOnce = false;
  private closing = false;
  private completed = false;
  private pendingBreakpointAcks = 0;
  private queuedContinue = false;

  constructor(private readonly token = '') {}
  public get isConnected(): boolean { return Boolean(this.socket && !this.socket.destroyed); }
  public get isCompleted(): boolean { return this.completed; }
  public onEvent(listener: (event: RuntimeEvent) => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }

  public async connect(host: string, port: number, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs; let lastError: unknown;
    this.closing = false; this.completed = false; this.pendingBreakpointAcks = 0; this.queuedContinue = false;
    while (Date.now() < deadline) {
      try { await this.connectOnce(host, port, Math.max(250, deadline - Date.now())); return; }
      catch (error) { lastError = error; this.disposeSocket(); await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw lastError instanceof Error ? lastError : new Error(`Unable to connect to XPscript debugger at ${host}:${port}.`);
  }

  public setBreakpoints(source: string, breakpoints: RuntimeBreakpoint[]): void {
    const normalized = source.replace(/\\/g, '/');
    const runtimeSource = normalized.slice(normalized.lastIndexOf('/') + 1);
    this.pendingBreakpointAcks++;
    try { this.send({ command: 'setBreakpoints', source: runtimeSource, breakpoints }); }
    catch (error) { this.pendingBreakpointAcks = Math.max(0, this.pendingBreakpointAcks - 1); throw error; }
  }
  public setGlobalConditionBreakpoints(conditions: string[]): void { this.send({ command: 'setGlobalConditionBreakpoints', conditions }); }
  public setDataBreakpoints(names: string[]): void { this.send({ command: 'setDataBreakpoints', names }); }
  public setExceptionBreakpoints(filters: string[]): void { this.send({ command: 'setExceptionBreakpoints', filters }); }

  public async valueHistory(name = ''): Promise<RuntimeValueHistoryEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const index = this.historyWaiters.findIndex(waiter => waiter.resolve === resolve); if (index >= 0) this.historyWaiters.splice(index, 1); reject(new Error('XPscript value history request timed out.')); }, 3000);
      const waiter: HistoryWaiter = { resolve, reject, timer }; this.historyWaiters.push(waiter);
      try { this.send({ command: 'valueHistory', name }); } catch (error) { clearTimeout(timer); const index = this.historyWaiters.indexOf(waiter); if (index >= 0) this.historyWaiters.splice(index, 1); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  public async debuggerVariables(): Promise<RuntimeDebuggerVariablesEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const index = this.debuggerVariableWaiters.findIndex(waiter => waiter.resolve === resolve); if (index >= 0) this.debuggerVariableWaiters.splice(index, 1); reject(new Error('XPscript debugger variables request timed out.')); }, 3000);
      const waiter: DebuggerVariableWaiter = { resolve, reject, timer }; this.debuggerVariableWaiters.push(waiter);
      try { this.send({ command: 'debuggerVariables' }); } catch (error) { clearTimeout(timer); const index = this.debuggerVariableWaiters.indexOf(waiter); if (index >= 0) this.debuggerVariableWaiters.splice(index, 1); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  public continue(): void { if (this.pendingBreakpointAcks > 0) { this.queuedContinue = true; return; } this.send({ command: 'continue' }); }
  public next(): void { this.send({ command: 'next' }); }
  public stepIn(): void { this.send({ command: 'stepIn' }); }
  public stepOut(): void { this.send({ command: 'stepOut' }); }
  public pause(): void { this.send({ command: 'pause' }); }
  public disconnect(): void { if (this.closing) return; this.closing = true; try { this.send({ command: 'disconnect' }); } catch { } const socket = this.socket; if (!socket) return; try { socket.end(); } catch { socket.destroy(); } setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 250).unref(); }
  public dispose(): void { this.closing = true; this.disposeSocket(); this.rejectPending(new Error('XPscript debugger runtime disconnected.')); }
  private disposeSocket(): void { const socket = this.socket; this.socket = undefined; if (socket && !socket.destroyed) socket.destroy(); }

  private async connectOnce(host: string, port: number, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`XPscript debugger handshake timed out at ${host}:${port}.`)); }, timeoutMs);
      const fail = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error); };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail); this.socket = socket; this.connectedOnce = true; this.closing = false; this.completed = false;
        this.helloResolve = () => { clearTimeout(timer); resolve(); }; this.helloReject = error => { clearTimeout(timer); reject(error); };
        socket.on('error', (error: NodeJS.ErrnoException) => { if ((error.code === 'ECONNRESET' || error.code === 'EPIPE') && (this.connectedOnce || this.completed)) return; if (!this.closing) this.emit({ type: 'error', message: error.message }); });
        socket.on('data', chunk => this.handleData(chunk.toString('utf8')));
        socket.on('end', () => this.flushTrailingBuffer());
        socket.on('close', () => { this.flushTrailingBuffer(); if (this.socket === socket) this.socket = undefined; this.rejectPending(new Error('XPscript debugger runtime disconnected.')); this.emit({ type: 'disconnected', completed: this.completed }); });
      });
    });
  }

  private send(message: Record<string, unknown>): void { const socket = this.socket; if (!socket || socket.destroyed) throw new Error('XPscript debugger runtime is not connected.'); const payload = this.token.length > 0 ? { ...message, token: this.token } : message; socket.write(JSON.stringify(payload) + '\n', 'utf8'); }
  private handleData(data: string): void { this.buffer += data; for (;;) { const newline = this.buffer.indexOf('\n'); if (newline < 0) break; const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1); if (line) this.handleLine(line); } }
  private flushTrailingBuffer(): void { const line = this.buffer.trim(); this.buffer = ''; if (line) this.handleLine(line); }
  private handleLine(line: string): void {
    let event: RuntimeEvent; try { event = JSON.parse(line) as RuntimeEvent; } catch { return; }
    if (event.type === 'hello') { const protocol = Number((event as RuntimeMessage).protocol ?? 0); if (protocol !== SUPPORTED_PROTOCOL) { const error = new Error(`Unsupported XPscript debugger protocol ${protocol}; expected ${SUPPORTED_PROTOCOL}.`); this.helloReject?.(error); this.helloResolve = undefined; this.helloReject = undefined; return; } this.helloResolve?.(); this.helloResolve = undefined; this.helloReject = undefined; }
    if (event.type === 'breakpoints') { this.pendingBreakpointAcks = Math.max(0, this.pendingBreakpointAcks - 1); if (this.pendingBreakpointAcks === 0 && this.queuedContinue) { this.queuedContinue = false; try { this.send({ command: 'continue' }); } catch { } } }
    if (event.type === 'valueHistory' && this.historyWaiters.length) { const waiter = this.historyWaiters.shift()!; clearTimeout(waiter.timer); waiter.resolve(event as RuntimeValueHistoryEvent); }
    if (event.type === 'debuggerVariables' && this.debuggerVariableWaiters.length) { const waiter = this.debuggerVariableWaiters.shift()!; clearTimeout(waiter.timer); waiter.resolve(event as RuntimeDebuggerVariablesEvent); }
    if (event.type === 'complete') this.completed = true;
    this.emit(event);
  }
  private emit(event: RuntimeEvent): void { for (const listener of this.listeners) listener(event); }
  private rejectPending(error: Error): void { for (const waiter of this.historyWaiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); } for (const waiter of this.debuggerVariableWaiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); } if (this.helloReject) this.helloReject(error); this.helloResolve = undefined; this.helloReject = undefined; }
}
