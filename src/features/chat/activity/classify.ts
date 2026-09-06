// 도구 호출 하나가 **무슨 활동인가** — 순수 provider 체인 (플랜 `v3-surface`
// `{#activity-classify}`).
//
// ## 규율: 틀리면 `shell` 로 흘린다
//
// 「일지를 썼습니다」는 **원장에 대한 주장**이다. 사용자 저장소에 파일이
// 생겼다고 화면이 말하는 것이라, 틀리면 제품이 거짓말을 한 것이 된다. 반대로
// 일지 기록을 그냥 「명령 실행」으로 그리는 것은 아쉬울 뿐 거짓이 아니다.
//
// 그래서 이 파일의 모든 판정은 **한쪽으로만 틀린다**: 확신이 없으면 아무 말도
// 하지 않고 다음 provider 에게, 끝내 모르면 도구 종류 그대로 흘린다.
//
// 체인 순서 (앞선 것이 이긴다):
//   1. MCP 도구 이름  — `mcp__oculpm__journal_write` 처럼 **이름이 곧 증거**다.
//   2. 셸 명령줄      — PATH 에 심어 둔 `oculpm` 이 돌았는가 (심 CLI).
//   3. 도구 종류      — ACP `ToolKind` 를 우리 어휘로.

import type { I18nKey } from "@/i18n";
import type { AcpToolCall } from "../acpTurns";
import type { ActivityKind } from "./activityTypes";

/**
 * `oculpm` CLI/MCP 가 받는 도구 이름 → 우리 어휘.
 *
 * 목록의 정본은 `src-tauri/src/oculpm/mcp/tools` 다 (CLI 는 같은 함수를 부르는
 * 어댑터일 뿐이라 이름이 하나다). 여기 없는 낱말은 **모르는 것**으로 두고
 * 흘려보낸다 — 새 도구가 생겼을 때 조용히 엉뚱한 어휘로 그리는 것보다 낫다.
 *
 * `project_init` 은 일부러 뺐다: 추적을 시작하는 한 번뿐인 설치 동작이라
 * 일지·계획·원장 어디에도 들지 않는다.
 */
const OCULPM_TOOL_KIND: Readonly<Record<string, ActivityKind>> = {
  journal_write: "oculpm-journal",
  journal_read: "oculpm-journal",
  journal_search: "oculpm-journal",
  plan_status: "oculpm-plan",
  plan_update: "oculpm-plan",
  plan_create: "oculpm-plan",
  agent_register: "oculpm-a2a",
  agent_list: "oculpm-a2a",
  agent_inbox: "oculpm-a2a",
  agent_send: "oculpm-a2a",
  task_create: "oculpm-a2a",
  task_update: "oculpm-a2a",
  claim_paths: "oculpm-a2a",
};

/** 이 낱말이 우리 도구인가. 아니면 `null` (모르는 것은 우리 것이 아니다). */
export function oculpmToolKind(tool: string): ActivityKind | null {
  return OCULPM_TOOL_KIND[tool] ?? null;
}

/**
 * 우리 도구의 **사람 말 이름표** 키. 모르는 도구면 `null`.
 *
 * 목록이 위의 표 하나뿐이라, 백엔드가 도구를 늘려도 사전에 없는 키가 화면에
 * 뜨는 일이 없다 — 표에 넣는 순간 사전 게이트(`pnpm test`)가 빠진 번역을 잡고,
 * 표에 없으면 어휘 이름으로 조용히 물러난다.
 */
export function oculpmVerbKey(tool: string): I18nKey | null {
  return tool in OCULPM_TOOL_KIND ? (`activity.verb.${tool}` as I18nKey) : null;
}

/** ACP `ToolKind` → 우리 어휘. 모르는 종류는 `other` 로 흘린다. */
const TOOL_KIND_MAP: Readonly<Record<string, ActivityKind>> = {
  read: "read",
  edit: "edit",
  delete: "delete",
  move: "move",
  search: "search",
  execute: "shell",
  think: "think",
  fetch: "web",
};

/** 분류에 쓰는 신호 — 도구 호출에서 **판정에 필요한 것만** 떼어 온 것. */
export interface ToolSignal {
  /** 도구 이름. 어댑터가 `_meta` 로만 주므로 없을 수 있다. */
  name?: string | null;
  /** ACP `tool_kind`. */
  kind?: string | null;
  /** 도구에 들어간 것 — 셸이면 명령줄 한 줄. */
  input?: string | null;
}

/** 우리 CLI 한 번 — 무슨 도구를 어떤 어휘로 불렀나. */
export interface OculpmCall {
  tool: string;
  kind: ActivityKind;
}

// ── 1. MCP 도구 이름 ────────────────────────────────────────────────────────

/**
 * `mcp__<서버>__<도구>` 에서 우리 서버를 알아본다.
 *
 * 서버 이름이 하나가 아니다: `.mcp.json` 에 우리가 심을 때는 `oculpm`,
 * Claude Code 플러그인으로 들어오면 `plugin_oculpm_oculpm` 이다. 그래서
 * **서버 칸에 `oculpm` 이 들어 있는가**로 본다 — 도구 이름이 우리 목록에
 * 있을 때만 이 판정이 힘을 쓰므로 넓게 봐도 남의 서버를 삼키지 않는다.
 */
export function parseOculpmMcpTool(name: string): OculpmCall | null {
  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") return null;
  const server = parts[1].toLowerCase();
  if (!server.includes("oculpm")) return null;
  const tool = parts.slice(2).join("__");
  const kind = oculpmToolKind(tool);
  return kind ? { tool, kind } : null;
}

// ── 2. 셸 명령줄 ────────────────────────────────────────────────────────────

/** 따옴표 밖에서 조각을 가르는 낱글자들. */
const SEGMENT_BREAKS = new Set(["|", "&", ";", "\n", "\r"]);

/**
 * 셸 한 줄을 **따옴표를 존중하며** 조각으로 가른다.
 *
 * `&&`·`|`·`;` 는 물론 명령 치환(`$(…)`·백틱)도 경계다 — 실제 관용구가
 * `h=$(oculpm plan_status …)` 이기 때문이다. 반대로 따옴표 **안**은 절대
 * 가르지 않는다: `oculpm journal_write '{"title":"a && b"}'` 의 `&&` 는
 * 연산자가 아니라 글자다.
 */
function shellSegments(command: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      // 작은따옴표 안에는 이스케이프가 없다 (POSIX) — 닫는 따옴표만 본다.
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        buf += ch + command[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      buf += ch + command[i + 1];
      i += 1;
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      push();
      i += 1;
      continue;
    }
    if (ch === "`" || ch === ")" || ch === "(") {
      push();
      continue;
    }
    if (SEGMENT_BREAKS.has(ch)) {
      push();
      continue;
    }
    buf += ch;
  }
  push();
  return out;
}

/** 조각 하나를 낱말로. 따옴표는 벗기지 않는다 — 첫 두 낱말만 볼 것이라 값이 없다. */
function words(segment: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** `FOO=bar` 꼴의 환경변수 접두. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * 셸 문자열에서 **우리 CLI 호출**을 알아본다. 확신이 없으면 `null`.
 *
 * 인정하는 모양은 하나뿐이다 — 맨 앞에 (환경변수 접두를 뺀) 낱말 `oculpm` 이
 * 오고, 그 다음 낱말이 우리 도구 목록에 있는 것.
 *
 * **경로가 붙은 `oculpm` 은 인정하지 않는다** (`/usr/local/bin/oculpm`·
 * `./oculpm`). 우리가 보장하는 것은 세션 심이 PATH 앞에 놓은 그 `oculpm`
 * 하나뿐이고, 남의 저장소에 같은 이름의 스크립트가 있을 수 있다.
 *
 * **한 줄에 우리 호출이 둘 이상이면 인정하지 않는다.** 한 줄에 이름표는
 * 하나인데 일어난 일이 둘이면, 어느 쪽을 적어도 나머지 하나를 숨기는 것이다.
 */
export function parseOculpmCliCommand(command: string): OculpmCall | null {
  if (!command || !command.includes("oculpm")) return null;
  let found: OculpmCall | null = null;
  for (const segment of shellSegments(command)) {
    const parts = words(segment);
    let at = 0;
    while (at < parts.length && ASSIGNMENT.test(parts[at])) at += 1;
    if (parts[at] !== "oculpm") continue;
    const kind = oculpmToolKind(parts[at + 1] ?? "");
    if (!kind) continue;
    // 둘째가 나오면 판정을 접는다 — 한 줄이 두 가지 일을 했다.
    if (found) return null;
    found = { tool: parts[at + 1], kind };
  }
  return found;
}

// ── 체인 ────────────────────────────────────────────────────────────────────

/** 이 도구 호출이 셸 명령인가 — 셸일 때만 명령줄을 읽는다. */
function isShellCall(signal: ToolSignal): boolean {
  if (signal.kind === "execute") return true;
  const name = signal.name?.toLowerCase();
  return name === "bash" || name === "shell";
}

/**
 * 이 도구 호출은 무슨 활동인가.
 *
 * `verb` 는 같은 어휘 안의 갈래다 (`journal_write`·`plan_update`) — 화면 문구가
 * 아니라 **근거**라서 번역하지 않는다. 문구는 프레젠터가 만든다.
 */
export function classifyTool(signal: ToolSignal): { kind: ActivityKind; verb: string | null } {
  const mcp = signal.name ? parseOculpmMcpTool(signal.name) : null;
  if (mcp) return { kind: mcp.kind, verb: mcp.tool };

  if (isShellCall(signal) && signal.input) {
    const cli = parseOculpmCliCommand(signal.input);
    if (cli) return { kind: cli.kind, verb: cli.tool };
  }

  const kind = TOOL_KIND_MAP[signal.kind ?? ""] ?? "other";
  return { kind, verb: signal.name ?? null };
}

/** 도구 호출 카드 하나의 활동 종류 (얇은 어댑터). */
export function classifyToolCall(call: AcpToolCall): { kind: ActivityKind; verb: string | null } {
  return classifyTool({ name: call.name, kind: call.kind, input: call.input });
}
