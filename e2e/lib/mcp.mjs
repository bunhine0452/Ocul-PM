// oculpm-mcp 사이드카를 **에이전트처럼** 부른다 — stdio 줄 단위 JSON-RPC.
// 앱이 설치해 다른 도구(Claude Code·Codex)에 등록하는 바로 그 실행 파일이다.

import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";

export async function callMcpTool({ bin, root, env, logFile, name, args, timeoutMs = 60_000 }) {
  const fd = openSync(logFile, "a");
  const child = spawn(bin, ["--root", root], { cwd: root, env, stdio: ["pipe", "pipe", fd], windowsHide: true });
  closeSync(fd);
  const pending = new Map();
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.on("error", (err) => {
    for (const p of pending.values()) p.reject(err);
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`JSON-RPC ${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  const rpc = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} ${timeoutMs / 1000}초 무응답`)), timeoutMs);
      pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  try {
    const init = await rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ocul-pm-e2e", version: "1" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const result = await rpc(2, "tools/call", { name, arguments: args });
    return { server: init?.serverInfo, result };
  } finally {
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 10_000))]);
    if (code === "timeout") child.kill();
  }
}
