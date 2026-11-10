#!/usr/bin/env node
/**
 * `pnpm tauri:log` — `pnpm tauri dev` 의 출력(vite + cargo + 앱 로그)을 화면에 보이면서 파일에도 쌓는다.
 * 세션마다 머리줄 하나로 가른다 (2026-07-20 리로드 진단에서 생겼다).
 *
 * 예전에는 package.json 한 줄의 셸 문법(`$(date …)` · `tee` · `/tmp`)이었다 — pnpm 은 Windows 에서 스크립트를
 * cmd.exe 로 돌리므로 거기서는 첫 글자부터 깨졌다(2026-11-10). 로그 자리는 macOS · Linux 에서 그대로
 * `/tmp/oculpm-tauri-dev.log`, Windows 는 임시 폴더(`%TEMP%`)다.
 *
 * 뒤에 붙인 인자는 그대로 넘긴다: `pnpm tauri:log --config other.json`.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logPath = join(process.platform === "win32" ? tmpdir() : "/tmp", "oculpm-tauri-dev.log");
const log = createWriteStream(logPath, { flags: "a" });
const stamp = new Date().toLocaleString("sv-SE"); // 2026-11-10 18:30:00 — `date '+%F %T'` 과 같은 모양
log.write(`===== dev session ${stamp} =====\n`);
console.log(`tauri:log → ${logPath}`);

// 이 스크립트를 띄운 pnpm 을 그대로 쓴다(셸 없이) — pnpm 이 `npm_execpath` 에 제 진입 파일을 넣어 준다.
// 직접 `node scripts/tauri-log.mjs` 로 띄웠으면 PATH 의 pnpm(Windows 는 pnpm.cmd 라 셸이 필요하다).
const args = ["tauri", "dev", ...process.argv.slice(2)];
const execPath = process.env.npm_execpath;
const child = execPath
  ? spawn(process.execPath, [execPath, ...args], { stdio: ["inherit", "pipe", "pipe"] })
  : spawn("pnpm", args, { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });

for (const [from, to] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  from.on("data", (chunk) => {
    to.write(chunk);
    log.write(chunk);
  });
}
// Ctrl+C 는 같은 콘솔의 자식에게도 간다 — 여기서는 자식이 끝나기를 기다렸다 그 코드로 나간다.
process.on("SIGINT", () => {});
child.on("close", (code) => log.end(() => process.exit(code ?? 1)));
