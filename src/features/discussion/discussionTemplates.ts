/**
 * 문제 해결 문서의 **디스크 산출물** 문자열 — 시작 템플릿 본문, 파서가
 * 알아보는 섹션 제목, 삽입 스니펫의 자리표시자.
 *
 * ## 왜 i18n 사전이 아니라 여기인가
 *
 * 이 문자열들은 화면 문구가 아니라 사용자 저장소의 `.oculpm/discussion/<slug>/
 * discussion.md` 에 **기록되는 내용**이다. 축도 UI 언어가 아니라 작성 언어
 * (`settings.contentLanguage`)다 — `rulesModel.ts` / `skillsModel.ts` 와 같은
 * 부류라 한글 게이트의 DISK_CONTENT 로 다룬다.
 *
 * ## 제목은 파서가 아는 여섯 개뿐이다
 *
 * `parse.rs::section_of` 가 못 알아보는 `## ` 제목 아래 본문은 읽기 화면
 * 투영에서 버려진다. 그래서 템플릿의 하위 구조는 `## ` 를 더 만들지 않고
 * `####` 로 판다 (파서는 `####` 를 그냥 본문 줄로 흘려보내므로 안전하다).
 */
import { getContentLang, type Lang } from "@/i18n";

import { LOG_BEGIN, LOG_END, type SectionKind } from "./mdEdit";

export type TemplateId = "blank" | "decision" | "kickoff" | "migration";

/** 새 문제 만들기 대화상자가 제시하는 순서. */
export const TEMPLATE_IDS: readonly TemplateId[] = ["blank", "decision", "kickoff", "migration"];

/** 파서가 인식하는 `## ` 제목 — 삽입 시 섹션이 없으면 이 이름으로 만든다. */
type Headings = Record<Exclude<SectionKind, "unknown">, string>;

const HEADINGS: Record<Lang, Headings> = {
  ko: {
    problem: "문제 정의",
    background: "배경 / 조사 자료",
    options: "후보 해결 방안",
    log: "토의 / 메모",
    conclusion: "결론",
    next: "다음 단계",
  },
  en: {
    problem: "Problem",
    background: "Background / research",
    options: "Options",
    log: "Discussion / notes",
    conclusion: "Conclusion",
    next: "Next steps",
  },
};

/** 토의 로그 표의 3열 머리 (시각 · 작성자 · 내용). */
const LOG_COLUMNS: Record<Lang, readonly [string, string, string]> = {
  ko: ["시각", "작성자", "내용"],
  en: ["When", "Author", "Note"],
};

/** 삽입 스니펫의 자리표시자 — 넣자마자 선택돼 바로 덮어쓰게 된다. */
const PLACEHOLDERS: Record<Lang, { option: string; step: string; url: string }> = {
  ko: { option: "방안 제목", step: "할 일", url: "링크" },
  en: { option: "Option title", step: "To do", url: "url" },
};

export function sectionHeadings(): Headings {
  return HEADINGS[getContentLang()];
}

export function logColumns(): readonly [string, string, string] {
  return LOG_COLUMNS[getContentLang()];
}

export function placeholders(): { option: string; step: string; url: string } {
  return PLACEHOLDERS[getContentLang()];
}

const EMPTY_LOG = `${LOG_BEGIN}\n${LOG_END}`;

// ── 템플릿 본문 ───────────────────────────────────────────────────────────
//
// frontmatter 는 백엔드(`create_discussion_skeleton`)가 이미 썼다 — 여기 값은
// **본문만**이고 `discussion_write` 가 그대로 갈아 끼운다.

const KO: Record<Exclude<TemplateId, "blank">, string> = {
  decision: `## 문제 정의

무엇을 결정해야 하는지 한두 문단으로.

#### 제약
반드시 지켜야 하는 것 (호환성 · 일정 · 비용).

#### 성공 기준
무엇이 참이면 이 결정이 옳았다고 할 수 있나.

## 배경 / 조사 자료

지금 코드·문서가 어떤 상태인지, 참고할 선례가 있는지.

## 후보 해결 방안

### 방안 A — 제목 {#opt-a}

한 문단 설명.

- 장점:
- 단점:
- 비용:

### 방안 B — 제목 {#opt-b}

한 문단 설명.

- 장점:
- 단점:
- 비용:

## 토의 / 메모

${EMPTY_LOG}

## 결론

채택안과 근거. (정해지면 status 를 resolved 로)

## 다음 단계

- [ ] 첫 실행 항목 {#next-1}
`,
  kickoff: `## 문제 정의

무엇을 만들려는지, 왜 지금인지.

#### 목표
이 프로젝트가 끝나면 무엇이 가능해지나.

#### 하지 않을 것
이번 범위 밖으로 명시해 두는 것 (나중에 다시 끌려 들어오지 않게).

#### 성공 기준
측정 가능한 형태로.

## 배경 / 조사 자료

이미 가진 자산 · 참고 사례 · 기술 제약.

## 후보 해결 방안

### 방안 A — 최소 기능부터 {#opt-a}

- 장점:
- 단점:

### 방안 B — 기반부터 {#opt-b}

- 장점:
- 단점:

## 토의 / 메모

${EMPTY_LOG}

## 결론

## 다음 단계

- [ ] 마일스톤 1 {#next-1}
- [ ] 마일스톤 2 {#next-2}
`,
  migration: `## 문제 정의

무엇을 어떻게 바꾸려 하는가.

#### 현재 상태
지금 구조와 그것이 만드는 통증.

#### 목표 상태
바뀐 뒤의 모습.

#### 영향 범위
건드리게 될 파일 · 화면 · 데이터 · 외부 계약.

## 배경 / 조사 자료

되돌리기 비용 · 이미 걸린 의존 · 선례.

## 후보 해결 방안

### 방안 A — 한 번에 교체 {#opt-a}

- 장점:
- 단점:
- 위험:

### 방안 B — 단계적 롤아웃 {#opt-b}

- 장점:
- 단점:
- 위험:

## 토의 / 메모

${EMPTY_LOG}

## 결론

## 다음 단계

- [ ] 1단계 — {#next-1}
- [ ] 2단계 — {#next-2}
- [ ] 롤백 절차 확인 {#next-3}
`,
};

const EN: Record<Exclude<TemplateId, "blank">, string> = {
  decision: `## Problem

What has to be decided, in a paragraph or two.

#### Constraints
What must hold (compatibility, schedule, cost).

#### Success criteria
What has to be true for this decision to have been right.

## Background / research

Where the code and docs stand today; any prior art worth citing.

## Options

### Option A — title {#opt-a}

One paragraph.

- Pros:
- Cons:
- Cost:

### Option B — title {#opt-b}

One paragraph.

- Pros:
- Cons:
- Cost:

## Discussion / notes

${EMPTY_LOG}

## Conclusion

The pick and why. (Set status to resolved once it is settled.)

## Next steps

- [ ] First step {#next-1}
`,
  kickoff: `## Problem

What we are building, and why now.

#### Goals
What becomes possible once this is done.

#### Non-goals
Explicitly out of scope, so it does not creep back in.

#### Success criteria
Stated so it can be measured.

## Background / research

Assets we already have, prior art, technical constraints.

## Options

### Option A — thinnest slice first {#opt-a}

- Pros:
- Cons:

### Option B — foundations first {#opt-b}

- Pros:
- Cons:

## Discussion / notes

${EMPTY_LOG}

## Conclusion

## Next steps

- [ ] Milestone 1 {#next-1}
- [ ] Milestone 2 {#next-2}
`,
  migration: `## Problem

What we are changing, and how.

#### Today
The current shape and the pain it causes.

#### Target
What it looks like afterwards.

#### Blast radius
Files, screens, data and external contracts this touches.

## Background / research

Cost of reverting, dependencies already taken, prior art.

## Options

### Option A — swap it in one go {#opt-a}

- Pros:
- Cons:
- Risk:

### Option B — staged rollout {#opt-b}

- Pros:
- Cons:
- Risk:

## Discussion / notes

${EMPTY_LOG}

## Conclusion

## Next steps

- [ ] Stage 1 — {#next-1}
- [ ] Stage 2 — {#next-2}
- [ ] Confirm the rollback path {#next-3}
`,
};

/**
 * 템플릿 본문. `"blank"` 은 `null` — 백엔드가 만든 골격을 그대로 둔다
 * (한 번 더 쓰면 `updated` 만 흔들고 얻는 게 없다).
 */
export function templateBody(id: TemplateId): string | null {
  if (id === "blank") return null;
  return (getContentLang() === "en" ? EN : KO)[id];
}
