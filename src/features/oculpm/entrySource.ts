// 기록의 **출처** — 누가 이 일지를 만들었는가 (Osaurus 라운드 Phase 3).
//
// 기록은 이미 여섯 곳에서 온다: 사람이 앱에서 직접, 외부 에이전트가 AGENTS.md
// 규칙대로, MCP 도구로, 세션 종료·정착 트리거의 LLM 초안이, 스케줄 자동화가,
// 감시 자동화가. 그런데 화면에서는 전부 같은 카드로 보였다. 자동화를 켠
// 다음부터 이건 결함이다 — 내가 쓴 것과 기계가 쓴 것을 못 가린다.
//
// **새 필드를 만들지 않는다.** session_id 접두와 agent.id 는 이미 디스크에
// 적혀 있는 사실이고, 러너도 "출처는 session_id 접두가 가른다"는 규약으로
// 쓰고 있다(`automation/runner.rs`). 여기서는 그 사실을 읽기만 한다.

/** 배지 8종. `SessionId` 의 변형(`session_id.rs`)과 1:1 로 대응한다. */
export type EntrySource =
  /** 사람이 앱의 작성기로 남겼다 (`agent.id = "manual"`). */
  | "direct"
  /** Claude Code 등 외부 에이전트가 규칙대로 썼다. */
  | "agent"
  /** 세션 종료·정착 트리거가 만든 LLM 초안 (`agent.id = "auto:<provider>"`). */
  | "draft"
  /** 시간 자동화 (`sched-`). */
  | "schedule"
  /** 감시 자동화 (`auto-`). */
  | "automation"
  /** MCP 도구 호출 (`mcp-`). */
  | "mcp"
  /** git 이력에서 복원 (`<workday>-git`). */
  | "backfill"
  /** 외부 대화 임포트 (`import-`) — Phase 7 이 채운다. */
  | "imported";

/** 화면에 나열할 때의 고정 순서 — 필터 레일도 이 순서를 쓴다. */
export const SOURCE_ORDER: readonly EntrySource[] = [
  "direct",
  "agent",
  "draft",
  "schedule",
  "automation",
  "mcp",
  "backfill",
  "imported",
] as const;

/** 자동 귀속의 접두 (`reconcile.rs` · `runner.rs` 가 쓰는 `auto:<provider>`). */
const AUTO_AGENT_PREFIX = "auto:";
/** 앱의 작성기가 남기는 agent.id — "사람이 썼다" 의 유일한 표식이다. */
const MANUAL_AGENT_ID = "manual";

/**
 * 접두 방언 → 출처. 값은 `session_id.rs` 의 상수와 같은 문자열이어야 한다.
 * `import-` 는 아직 발급하는 곳이 없다 — Phase 7 이 채울 때 이 표만 참이면
 * 배지·필터가 저절로 따라온다.
 */
const PREFIXED: readonly [string, EntrySource][] = [
  ["sched-", "schedule"],
  ["auto-", "automation"],
  ["mcp-", "mcp"],
  ["import-", "imported"],
];

/**
 * 접두 뒤가 `YYYYMMDD-` 인가. **백엔드 `SessionId::kind()` 와 같은 엄격도**다 —
 * 느슨하게 읽으면 손으로 적은 `auto-tune` 같은 값이 "감시 자동화"로 둔갑한다.
 */
function hasWorkdayTail(rest: string): boolean {
  return rest.length >= 9 && /^\d{8}-/.test(rest);
}

/** `<workday>-git` — 백필 작성기가 쓰는 유일한 모양. */
function isGitBackfill(sessionId: string): boolean {
  return /^\d{8}-git$/.test(sessionId);
}

/**
 * 이 기록의 출처. **순수 함수** — 같은 입력이면 언제나 같은 값이다.
 *
 * 판정 순서가 곧 규약이다: 세션 접두가 먼저고 `agent.id` 가 나중이다.
 * 자동화가 쓴 일지의 `agent.id` 는 `auto:<provider>` 라서, agent 를 먼저 보면
 * 스케줄도 감시도 전부 "자동 초안" 으로 뭉개진다.
 */
export function sourceOf(sessionId: string | null | undefined, agentId: string): EntrySource {
  const sid = (sessionId ?? "").trim();
  for (const [prefix, source] of PREFIXED) {
    if (sid.startsWith(prefix) && hasWorkdayTail(sid.slice(prefix.length))) return source;
  }
  if (isGitBackfill(sid)) return "backfill";
  return sourceOfAgent(agentId);
}

/**
 * 세션 id 없이 `agent.id` 만 있는 자리(회고의 에이전트 기여 행)의 판정.
 * 셋으로만 갈린다 — 나머지 다섯은 세션 접두가 있어야 알 수 있다.
 */
export function sourceOfAgent(agentId: string): EntrySource {
  const agent = (agentId ?? "").trim();
  if (agent.startsWith(AUTO_AGENT_PREFIX)) return "draft";
  if (agent === "" || agent === MANUAL_AGENT_ID) return "direct";
  return "agent";
}

/** 목록 안에 실제로 나타난 출처들 — [`SOURCE_ORDER`] 순서, 없는 것은 빠진다. */
export function sourcesPresent(sources: readonly EntrySource[]): EntrySource[] {
  const seen = new Set(sources);
  return SOURCE_ORDER.filter((s) => seen.has(s));
}

/**
 * 필터 레일을 그릴 것인가. **소스가 1종뿐이면 그리지 않는다** — 아무것도
 * 좁히지 못하는 필터는 기능이 아니라 소음이다 (Osaurus 도 같은 규칙).
 */
export function shouldShowRail(sources: readonly EntrySource[]): boolean {
  return sourcesPresent(sources).length > 1;
}
