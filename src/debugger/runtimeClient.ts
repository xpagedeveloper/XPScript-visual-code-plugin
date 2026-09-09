import * as net from 'net';

export interface RuntimeStoppedEvent {
  type: 'stopped';
  reason: 'entry' | 'breakpoint' | 'step' | 'pause';
  source: string;
  line: number;
  threadId: number;
}

export type RuntimeEvent = RuntimeStoppedEvent | Record<string, unknown>;

export class XPScriptRuntimeClient {
  private socket: net.Socket | undefined;
  private buffer = '';
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(private readonly token = '') {}

  public onEvent(listener: (event: RuntimeEvent) => void): vscode.DisposableLike {
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
        for (const listener of this.listeners) listener(event);
      } catch {
        // Ignore malformed runtime frames and keep the debug channel alive.
      }
    }
  }
}

namespace vscode {
  export interface DisposableLike { dispose(): void; }
}
