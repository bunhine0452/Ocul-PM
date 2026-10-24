#!/usr/bin/env node
// ACP 어댑터 핸드셰이크 스모크 — 고정 판을 올릴 때 (2026-10-24, acp-lock 보안 갱신).
//
// 우리 클라이언트와 같은 모양의 `initialize`(v1 + `_meta.jetbrains.air` 광고, acp/process.rs)
// 와 `session/new`(commands/acp.rs, MCP 서버만 뺌)를 보내고 응답을 받는다. 프롬프트는
// 절대 보내지 않는다 — 모델 호출 0.
//
// 안전장치: 어댑터는 `sandbox-exec` 로 **바깥 네트워크가 막힌 채** 돌고, HOME ·
// CLAUDE_CONFIG_DIR · CODEX_HOME 은 빈 임시 폴더다. 제공자에 닿지도, 사용자 자격 증명을
// 보지도 못한다 (macOS 전용).
//
// 쓰는 법 — 임시 폴더에서 acp-lock 의 트리를 그대로 깐 뒤:
//   cp src-tauri/acp-lock/claude/package*.json $TMP/claude/
//   npm ci --ignore-scripts --prefix $TMP/claude
//   node docs/acp-panel/spike/acp_handshake_smoke.mjs \
//     $TMP/claude/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js $TMP/hs \
//     --session --fixture src-tauri/src/acp/fixtures/claude-agent-acp.json
// Codex 는 인증 없이 `session/new` 가 "Authentication required" 라 `--session` 없이 받는다.
// 픽스처는 `adapter.rs` 의 `the_pinned_adapters_handshake_parses_with_our_crate` 가 읽는다.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const [entry, work] = args;
const withSession = args.includes("--session");
const fixtureAt = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;
const home = join(work, "home");
const cwd = join(work, "project");
for (const dir of [join(home, ".claude"), join(home, ".codex"), cwd]) mkdirSync(dir, { recursive: true });

const profile = '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))';
const env = {
  PATH: process.env.PATH,
  HOME: home,
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  CODEX_HOME: join(home, ".codex"),
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  OCULPM_ACP_HOST: "1",
};
const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, entry], { cwd, env });

const seen = [];
const pending = new Map();
let nextId = 1;
let buf = "";
const send = (method, params) => {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
};
child.stdout.on("data", (chunk) => {
  buf += chunk;
  for (let i; (i = buf.indexOf("\n")) >= 0; ) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && !msg.method && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method && msg.id != null) {
      // 에이전트 → 클라이언트 요청(권한 등)은 거절한다.
      seen.push(`request ${msg.method}`);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "smoke" } }) + "\n");
    } else if (msg.method) {
      seen.push(msg.params?.update?.sessionUpdate ?? msg.method);
    }
  }
});
let stderr = "";
child.stderr.on("data", (c) => (stderr += c));
const within = (ms, p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ timeout: ms }), ms))]);

const init = await within(60_000, send("initialize", {
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    _meta: { jetbrains: { air: { version: 1, capabilities: ["sessionFailure", "agentFileChangeReport"] } } },
  },
  clientInfo: { name: "ocul-pm", version: "smoke" },
}));
const session = withSession && init.result ? await within(90_000, send("session/new", { cwd, mcpServers: [] })) : null;
await within(3_000, new Promise(() => {}));
child.kill("SIGTERM");

console.log(JSON.stringify({
  initialize: init.result ? { protocolVersion: init.result.protocolVersion, agentInfo: init.result.agentInfo } : init,
  sessionNew: session ? (session.result ? "ok" : session.error ?? session) : "skipped",
  notifications: [...new Set(seen)],
  stderrTail: init.result ? undefined : stderr.slice(-800),
}, null, 1));

if (fixtureAt && init.result) {
  const fixture = { initialize: init.result };
  if (session?.result) fixture.sessionNew = { ...session.result, sessionId: "00000000-0000-0000-0000-000000000000" };
  const text = JSON.stringify(fixture, null, 1) + "\n";
  if (text.includes(work) || text.includes(home)) throw new Error("임시 경로가 픽스처에 샜다");
  writeFileSync(fixtureAt, text);
}
process.exit(init.result ? 0 : 1);
