// 활동 어휘 — 에이전트가 한 일을 **우리 말로** 부르는 15낱말 (플랜 `v3-surface`
// `{#activity-types}`).
//
// 지금까지 이 화면은 도구 호출을 **날것 그대로** 그렸다. 그래서 우리 제품의
// 값어치가 화면에서 사라진다: PATH 에 심어 둔 `oculpm` 이 일지를 쓰고 있는데,
// 화면은 그것을 「명령 실행 + 터미널 아이콘」으로 그렸다. 「일지를 썼다」가
// 화면 어휘에 아예 없었다.
//
// ## 15낱말을 어떻게 골랐나
//
// 지어내지 않고 **실제 이벤트 표면에서** 뽑았다:
//
//  - ACP 프로토콜의 `ToolKind` 9종 (read·edit·delete·move·search·execute·
//    think·fetch·switch_mode) → 앞의 8은 그대로, `switch_mode` 는 `other` 로
//    흘린다 (모드 전환은 도구가 아니라 세션 사건이다).
//  - 도구가 아닌 조각 3종 — 할 일 목록(`AcpTurn.plan`), 승인 요청
//    (`AcpEvent::Permission`), 실패(`AcpBlock` 의 `failure`).
//  - 그리고 **우리만의 셋** — `oculpm-journal` · `oculpm-plan` · `oculpm-a2a`.
//
// 앞의 열둘은 어느 에이전트 UI 에나 있다. 뒤의 셋이 이 제품이 존재하는 이유고,
// 그래서 이 셋만 별도 규율을 받는다 (아래 `NEVER_FOLD`).
//
// `write` 를 따로 두지 않은 이유: 프로토콜에 `write` 종류가 없다. Claude 의
// `Write` 도구도 `edit` 로 온다. 채울 수 없는 낱말을 어휘에 두면 그 자체가
// 거짓말이다 — 어휘는 이벤트가 줄 수 있는 것만 담는다.

/** 우리 어휘 15낱말. 순서는 화면 순서가 아니라 **읽는 순서**다 (우리 것 먼저). */
export const ACTIVITY_KINDS = [
  "oculpm-journal",
  "oculpm-plan",
  "oculpm-a2a",
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "shell",
  "web",
  "think",
  "todo",
  "permission",
  "error",
  "other",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** 이 활동이 지금 어디쯤인가. 도구 상태 4종을 화면이 쓰는 3상태로 좁힌 것. */
export type ActivityStatus = "running" | "done" | "failed";

/**
 * 우리만의 값어치 셋.
 *
 * 이 셋은 **사용자 저장소에 파일을 남기는 일**이다 — 나머지 열둘과 성격이
 * 다르다. 읽기 스무 번은 접어도 되지만 일지 한 건은 접으면 안 된다.
 */
export const OCULPM_KINDS: ReadonlySet<ActivityKind> = new Set([
  "oculpm-journal",
  "oculpm-plan",
  "oculpm-a2a",
]);

export function isOculpmKind(kind: ActivityKind): boolean {
  return OCULPM_KINDS.has(kind);
}

/**
 * **개입 지점** — 사용자가 눌러야 풀리는 것.
 *
 * `acpBusyBus` 의 `attention` 집합이 사이드바에 그리는 것과 같은 개념이다:
 * 작업 중은 기다리면 되지만 승인 대기는 사람이 눌러야 풀린다. 여기서 한 번
 * 더 적어 두는 이유는 묶기(`group.ts`)가 이 집합을 근거로 삼기 때문이다 —
 * 버스는 세션 단위, 이쪽은 활동 단위라 자료가 다르고 규율만 같다.
 */
export const ATTENTION_KINDS: ReadonlySet<ActivityKind> = new Set(["permission"]);

/**
 * **절대 접지 않는 것.**
 *
 * 접는다는 것은 "이건 훑고 지나가도 된다"는 말이다. 셋은 그렇지 않다:
 *  - `permission` — 사람이 눌러야 턴이 풀린다. 접히면 화면이 멈춘 것처럼 보인다.
 *  - `error`      — 실패를 접으면 그 턴은 성공한 것처럼 읽힌다.
 *  - `oculpm-*`   — 원장에 남은 기록이다. 이 셋을 접으면 이 화면을 만든 이유가
 *                   사라진다.
 */
export const NEVER_FOLD: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  ...ATTENTION_KINDS,
  "error",
  ...OCULPM_KINDS,
]);

export function isFoldableKind(kind: ActivityKind): boolean {
  return !NEVER_FOLD.has(kind);
}
