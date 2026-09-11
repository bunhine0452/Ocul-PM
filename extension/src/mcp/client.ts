// `oculpm-mcp` stdio 클라이언트 — 라인 단위 JSON-RPC 2.0. 서버(protocol.rs)가
// 같은 이유로 SDK 없이 직접 구현했듯 여기도 직접 쓴다: 필요한 표면이
// initialize / tools/call 둘뿐이고, `@modelcontextprotocol/sdk` 는 ESM 전용에
// 의존성이 많아 CJS 번들·엔진 하한(^1.101)과의 마찰이 더 크다. 그래도 handshake
// (initialize → notifications/initialized)는 표준대로 보낸다.
//
// 프로젝트 루트마다 프로세스 하나(`--root <dir>`), 첫 호출 때 띄우고 dispose 때
// 죽인다. stdout 은 프로토콜, stderr 는 사람용 로그 → 출력 채널로.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";

export const AGENT_ID = "vscode-ext";
export const REQUEST_TIMEOUT_MS = 10_000;
/** 서버 `WRITE_CONFLICT_PREFIX` — base_hash 충돌 판정. */
export const WRITE_CONFLICT_PREFIX = "write-conflict:";

export class McpToolError extends Error {
  constructor(message: string, readonly tool: string) {
    super(message);
    this.name = "McpToolError";
  }
  get isConflict(): boolean {
    return this.message.startsWith(WRITE_CONFLICT_PREFIX);
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpClientOptions {
  binary: string;
  root: string;
  agentId?: string;
  onStderr?: (line: string) => void;
}

export class OculpmMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;

  constructor(private readonly opts: McpClientOptions) {}

  /** 도구 호출 — 서버 `result.content[0].text` 의 JSON 을 돌려준다. `isError` 면 throw. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureReady();
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = result.content?.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) {
      throw new McpToolError(text, name);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("oculpm-mcp 클라이언트가 닫혔습니다"));
    }
    this.pending.clear();
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.start();
    return this.ready;
  }

  private async start(): Promise<void> {
    const proc = spawn(this.opts.binary, ["--root", this.opts.root], {
      cwd: this.opts.root,
      env: { ...process.env, OCULPM_AGENT_ID: this.opts.agentId ?? AGENT_ID },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line));
    readline.createInterface({ input: proc.stderr }).on("line", (line) => this.opts.onStderr?.(line));
    proc.on("exit", (code) => {
      const err = new Error(`oculpm-mcp 가 종료됐습니다 (code ${code ?? "?"})`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      this.proc = null;
      this.ready = null;
    });
    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", () => resolve());
      proc.once("error", reject);
    });
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ocul-pm-vscode", version: "0.0.1" },
    });
    this.notify("notifications/initialized");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`oculpm-mcp ${method} 응답이 ${REQUEST_TIMEOUT_MS}ms 안에 없습니다`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string): void {
    this.write({ jsonrpc: "2.0", method });
  }

  private write(msg: unknown): void {
    this.proc?.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id !== "number") {
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) {
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error(msg.error.message ?? "JSON-RPC error"));
    } else {
      p.resolve(msg.result);
    }
  }
}
