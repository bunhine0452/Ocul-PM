// 화면 하네스의 타입 — 개발 전용(scripts/harness/README.md). 앱 번들에 들어가지 않는다.
//
// 핸들러가 돌려주는 모양을 `src/lib/bindings.ts`(tauri-specta 생성물)에서 **뽑아** 쓴다.
// 그래서 백엔드 타입이 바뀌면 `pnpm typecheck` 가 하네스를 물고, 하네스가 낸 가짜 결함
// (필드 빠짐 · 문자열로 읽은 배열)이 화면 버그로 오해받지 않는다.
import type {
  commands,
  Difficulty,
  EntryStatus,
  EntryType,
  GitChange,
  PlanDecisionDto,
  PlanItemDto,
  PlanItemUpdateDto,
  PlanPhaseDto,
  PlanSummary,
} from "@/lib/bindings";

/** 명령 인자 — IPC 로 오는 이름 붙은 객체. 이름은 타입에서 못 뽑아 느슨하게 둔다. */
export type Args = Record<string, unknown>;

/** `fixtures.mjs` 가 이 저장소의 `.oculpm` 에서 뽑는 일지 한 건(프런트매터 + 본문). */
export interface FixtureJournal {
  relative_path: string;
  workday: string;
  type: EntryType;
  slug: string;
  status: EntryStatus;
  difficulty: Difficulty | null;
  title: string;
  checkbox: boolean | null;
  session_id: string;
  agent_id: string;
  agent_version: string | null;
  agent_session: string | null;
  verified_by_user: boolean;
  verified_stale: boolean;
  /** `src-tauri/src/oculpm/evidence.rs` 의 등급 — 0 검증 칸 없음 · 1 글만 · 2 돌린 명령. */
  evidence: number;
  created_at: string;
  updated_at: string | null;
  tags: string[];
  files: { path: string; op: string }[];
  related: { ref: string; kind: string }[];
  language: string;
  files_count: number;
  body_markdown: string;
  byte_size: number;
}

export interface FixturePlan {
  summary: PlanSummary;
  items: PlanItemDto[];
  phases: PlanPhaseDto[];
  decisions: PlanDecisionDto[];
  warnings: string[];
  done_when: string | null;
  check: string | null;
  log: PlanItemUpdateDto[];
}

export interface Fixtures {
  /** 시계를 고정할 때(`now=` 로 바꿀 수 있다) — 마지막 작업일 18:20 KST. */
  nowIso: string;
  workdays: string[];
  journals: FixtureJournal[];
  plans: FixturePlan[];
  /** 커밋 전 변경으로 보일 파일 — 실제 최근 커밋의 파일 · 패치. */
  changes: GitChange[];
  patches: Record<string, string>;
  /** `changes` 중 이 일지들 어디에도 안 적힌 파일 — 「일지 없는 변경」 묶음의 재료. */
  unrecorded: string[];
}

// ---- bindings 에서 「명령 이름(snake) → 응답」 표를 뽑는다 ----

type Commands = typeof commands;

/** `todayDigest` → `today_digest` */
type Snake<S extends string> = S extends `${infer C}${infer R}`
  ? `${C extends Lowercase<C> ? C : `_${Lowercase<C>}`}${Snake<R>}`
  : S;

/** `{ status: "ok", data }` 봉투면 data, 아니면(`__TAURI_INVOKE<T>` 직접 호출) 그대로. */
type Unwrap<P> = [Extract<P, { status: "ok" }>] extends [never]
  ? P
  : Extract<P, { status: "ok" }> extends { data: infer D }
    ? D
    : never;

export type CmdData = {
  [K in keyof Commands as Snake<K & string>]: Unwrap<Awaited<ReturnType<Commands[K]>>>;
};

/** 핸들러 표 — 키는 bindings 의 명령 이름만, 값은 그 명령의 응답 모양이어야 한다. */
export type Typed = {
  [C in keyof CmdData]?: (a: Args) => CmdData[C] | Promise<CmdData[C]>;
};
