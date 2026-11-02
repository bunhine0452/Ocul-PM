// Claude 가 사람을 기다린다 — 플러그인 Notification 훅이 `.oculpm/hooks/claude-events.jsonl` 에 남긴 줄을 읽어
// 세션마다 기다림을 든다. 앱 `oculpm/claude_waiting.rs::apply_waiting` 과 같은 규칙이고, 둘은
// `src-tauri/src/oculpm/waiting_cases.json` 사례표를 함께 읽는다(`waiting.spec.ts`). 앱 없이도 돈다.

export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  notification_type?: string | null;
  message?: string | null;
  oculpm_ts?: string | null;
  cwd?: string | null;
}

export interface Waiting {
  sessionId: string;
  /** `permission` · `idle` */
  kind: string;
  message: string | null;
  since: string;
}

/** 앱 `WAITING_STALE_MINUTES` — 훅이 끝을 못 알린 세션(터미널을 그냥 닫음)이 남지 않게. */
export const WAITING_STALE_MINUTES = 30;

const CLEARS = new Set(["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd", "SessionStart"]);

/** 이벤트 하나를 반영한다. 바뀌었으면 `true`. */
export function applyWaiting(waiting: Map<string, Waiting>, ev: HookEvent, now: string): boolean {
  const id = ev.session_id ?? "";
  if (!id) return false;
  const name = ev.hook_event_name ?? "";
  if (name === "Notification") {
    const kind =
      ev.notification_type === "permission_prompt" ? "permission" : ev.notification_type === "idle_prompt" ? "idle" : null;
    if (!kind) return false;
    const message = ev.message && ev.message.trim() ? ev.message : null;
    const next: Waiting = { sessionId: id, kind, message, since: ev.oculpm_ts ?? now };
    const prev = waiting.get(id);
    waiting.set(id, next);
    return !prev || prev.kind !== kind || prev.message !== message || prev.since !== next.since;
  }
  if (CLEARS.has(name)) return waiting.delete(id);
  return false;
}

/** 인박스 글(JSON 한 줄씩)에서 지금 기다리는 세션들 — 오래된 것은 뺀다. 오래 기다린 것부터. */
export function waitingFrom(text: string, nowMs: number): Waiting[] {
  const map = new Map<string, Waiting>();
  const now = new Date(nowMs).toISOString();
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    let ev: HookEvent;
    try {
      ev = JSON.parse(s) as HookEvent;
    } catch {
      continue; // 쓰는 도중 잘린 끝줄
    }
    applyWaiting(map, ev, now);
  }
  const cutoff = nowMs - WAITING_STALE_MINUTES * 60_000;
  return [...map.values()]
    .filter((w) => {
      const at = Date.parse(w.since);
      return Number.isNaN(at) || at >= cutoff;
    })
    .sort((a, b) => a.since.localeCompare(b.since));
}

/**
 * `ask_user` 가 앱에 띄운 질문 — `.oculpm/hooks/questions/<id>.json` (앱 `ClaudeQuestion`). 확장은 보여 주기만
 * 하고 답은 앱(오늘 화면)이나 그 claude 세션에서 한다 — 확장은 `.oculpm/` 에 쓰지 않는다(.claude/rules/vscode-extension.md).
 */
export interface Question {
  id: string;
  question: string;
  options: string[];
  askedAt: string;
}

/** 질문 파일 하나를 읽는다. 모양이 틀리면 `null`. */
export function parseQuestion(raw: string): Question | null {
  try {
    const v = JSON.parse(raw) as { id?: unknown; question?: unknown; options?: unknown; asked_at?: unknown };
    if (typeof v.id !== "string" || typeof v.question !== "string" || typeof v.asked_at !== "string") return null;
    if (!/^[A-Za-z0-9-]+$/.test(v.id)) return null;
    const options = Array.isArray(v.options) ? v.options.filter((o): o is string => typeof o === "string") : [];
    return { id: v.id, question: v.question, options, askedAt: v.asked_at };
  } catch {
    return null;
  }
}
