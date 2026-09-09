import * as net from 'net';

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
  reason: 'entry' | 'breakpoint' | 'step' | 'pause' | 'data breakpoint';
  source: string;
  line: number;
  threadId: number;
  frames?: RuntimeStackFrame[];
  dataId?: string;
  description?: string;
}

export interface RuntimeValueHistoryEvent {
  type: 'valueHistory';
  name: string;
  items: RuntimeValueChange[];
}

export interface RuntimeMessage {
  type: string;
  [key: string]: unknown;
}

export type RuntimeEvent = RuntimeStoppedEvent | RuntimeValueHistoryEvent | RuntimeMessage;

export class XPScriptRuntimeClient {
  private socket: net.Socket | undefined;
  private buffer = '';
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly historyWaiters: Array<(event: RuntimeValueHistoryEvent) => void> = [];

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
        await this.connectOnce(host, port);
        return;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to connect to XPscript debugger at ${host}:${port}.`);
  }

  public setBreakpoints(source: string, lines: number[]): void {
    this.send({ command: 'setBreakpoints', source, lines });
  }

  public setDataBreakpoints(names: string[]): void {
    this.send({ command: 'setDataBreakpoints', names });
  }

  public async valueHistory(name = ''): Promise<RuntimeValueHistoryEvent> {
    return new Promise<RuntimeValueHistoryEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('XPscript value history request timed out.')), 3000);
      this.historyWaiters.push(event => {
        clearTimeout(timer);
        resolve(event);
      });
      try {
        this.send({ command: 'valueHistory', name });
      } catch (error) {
        clearTimeout(timer);
        this.historyWaiters.pop();
        reject(error);
      }
    });
  }

  public continue(): void { this.send({ command: 'continue' }); }
  public next(): void { this.send({ command: 'next' }); }
  public stepIn(): void { this.send({ command: 'stepIn' }); }
  public stepOut(): void { this.send({ command: 'stepOut' }); }
  public pause(): void { this.send({ command: 'pause' }); }
  public disconnect(): void { this.send({ command: 'disconnect' }); this.dispose(); }

  public dispose(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private async connectOnce(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        socket.on('error', () => this.dispose());
        socket.on('data', chunk => this.handleData(chunk.toString('utf8')));
        socket.on('close', () => { if (this.socket === socket) this.socket = undefined; });
        this.socket = socket;
        resolve();
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
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as RuntimeEvent;
        if (event.type === 'valueHistory' && this.historyWaiters.length > 0) {
          const waiter = this.historyWaiters.shift();
          waiter?.(event as RuntimeValueHistoryEvent);
        }
        for (const listener of this.listeners) listener(event);
      } catch {
        // Ignore malformed runtime frames and keep the debug channel alive.
      }
    }
  }
}
