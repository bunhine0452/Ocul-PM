// 프로젝트 루트별 클라이언트 풀 — 바이너리 경로가 바뀌면(재탐색) 전부 닫고 다시 띄운다.
import * as vscode from "vscode";
import { OculpmMcpClient } from "./client";

export class McpPool implements vscode.Disposable {
  private readonly clients = new Map<string, OculpmMcpClient>();
  private binary: string | null = null;
  private readonly output = vscode.window.createOutputChannel("Ocul-PM");

  setBinary(path: string | null): void {
    if (path === this.binary) {
      return;
    }
    this.binary = path;
    this.closeAll();
  }

  /** 바이너리가 없으면 null — 호출자는 읽기 전용으로 처리한다. */
  for(root: string): OculpmMcpClient | null {
    if (this.binary === null) {
      return null;
    }
    let c = this.clients.get(root);
    if (!c) {
      c = new OculpmMcpClient({ binary: this.binary, root, onStderr: (l) => this.output.appendLine(l) });
      this.clients.set(root, c);
    }
    return c;
  }

  closeAll(): void {
    for (const c of this.clients.values()) {
      c.dispose();
    }
    this.clients.clear();
  }

  dispose(): void {
    this.closeAll();
    this.output.dispose();
  }
}
