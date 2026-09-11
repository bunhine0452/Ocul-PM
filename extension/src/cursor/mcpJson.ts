// `.cursor/mcp.json` 머지 — Cursor·Antigravity 등 `vscode.lm` 이 없는 포크의
// 유일한 등록 경로(2026-02 시점 Cursor 는 MCP 공급자 API 미지원). 규율은
// `src-tauri/src/oculpm/mcp/register.rs` 그대로: 우리 키(`oculpm`)만 만지고,
// 남의 서버 정의는 보존하며, **파싱 불가 파일은 절대 덮어쓰지 않는다**. 우리
// 엔트리는 command 에 든 `oculpm-mcp` 조각으로 식별한다.
export const SERVER_KEY = "oculpm";
export const BINARY_SIGNATURE = "oculpm-mcp";

export interface CursorEntry {
  binary: string;
  root: string;
  agentId: string;
}

export type MergeOutcome =
  | { kind: "write"; text: string; created: boolean }
  | { kind: "unchanged" }
  | { kind: "error"; message: string };

export function serverEntry(e: CursorEntry): Record<string, unknown> {
  return { command: e.binary, args: ["--root", e.root], env: { OCULPM_AGENT_ID: e.agentId } };
}

/** 순수 — `raw` 는 파일 내용(없으면 null). 디스크는 호출자가 만진다. */
export function mergeCursorMcpJson(raw: string | null, entry: CursorEntry): MergeOutcome {
  let value: unknown = {};
  const created = raw === null || raw.trim() === "";
  if (!created) {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { kind: "error", message: `.cursor/mcp.json 을 파싱할 수 없어 건드리지 않았습니다: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (!isObject(value)) {
    return { kind: "error", message: ".cursor/mcp.json 의 최상위가 JSON 객체가 아닙니다" };
  }
  const servers = value.mcpServers ?? (value.mcpServers = {});
  if (!isObject(servers)) {
    return { kind: "error", message: '.cursor/mcp.json 의 "mcpServers" 가 객체가 아닙니다' };
  }
  const next = serverEntry(entry);
  if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(next)) {
    return { kind: "unchanged" };
  }
  servers[SERVER_KEY] = next;
  return { kind: "write", text: `${JSON.stringify(value, null, 2)}\n`, created };
}

/** 등록 여부 — 우리 키가 있거나 서명이 든 엔트리가 있으면 true. */
export function isRegistered(raw: string | null): boolean {
  if (raw === null) {
    return false;
  }
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v) || !isObject(v.mcpServers)) {
      return false;
    }
    return Object.entries(v.mcpServers).some(
      ([k, e]) => k === SERVER_KEY || (isObject(e) && typeof e.command === "string" && e.command.includes(BINARY_SIGNATURE)),
    );
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
