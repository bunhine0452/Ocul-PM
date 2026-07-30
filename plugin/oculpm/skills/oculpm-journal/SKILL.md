---
name: oculpm-journal
description: ocul-pm recording spec (journal format, planner glyphs/log, discussion docs) for projects with .oculpm/. Use when finishing a unit of work and the oculpm MCP tools are unavailable — prefer journal_write/plan_update when visible.
---

# ocul-pm 기록 규격 (풀 스펙)

**MCP 도구가 보이면 이 스킬 대신 도구를 쓴다** — `journal_write` / `plan_status` /
`plan_update` 가 경로·파일명·frontmatter 규격을 서버에서 보장한다. 아래는 도구가
없을 때 파일을 직접 쓰는 규격이다.

## 1. 작업 일지

경로: `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md`

- `TypeFolder` = `Bugs` | `Features_to_add` | `Errors` | `Refactors` | `Chores`
- `type` ∈ {`bug`, `feature`, `error`, `refactor`, `chore`}, `slug` = ASCII kebab-case ≤40자
- 하나의 파일에 두 개 이상의 작업을 묶지 말 것. 기존 일지 수정 금지 (새 파일 + `related` 링크).

frontmatter (8개 필수 — 자주 틀리는 3가지: ① `created_at` 은 `+09:00` 형태 tz offset 필수,
② `agent` 는 id/version 키를 가진 **mapping**, ③ `files_touched[].op` 은
`create|update|delete|rename|correct` enum 만):

```yaml
---
schema_version: 1
type: bug
slug: short-kebab-slug
status: done            # planned | in_progress | done | abandoned
created_at: "2026-07-31T14:03:00+09:00"
session_id: "manual-<workday>-HHMMSS"
agent: { id: claude-code, version: "모델명" }
language: ko
verified_by_user: false
files_touched: [{ path: src/x.rs, op: update }]
related: []
tags: []
---
```

본문: 첫 줄 `[x] 제목` 체크박스. 타입별 강제 헤더 — bug/error: `## 발생 원인` →
`## 해결 방법`, feature: `## 추가 기능` → `## 동작 흐름`, refactor: `## 동기` →
`## 변경 요약`. 공통 끝: `## 검증` (필수, 1~3줄), `## 메모` (선택).

금지: `.oculpm/index/**` 쓰기, secrets/API key 포함, 기존 일지 수정.

## 2. 플래너 갱신 (일지 직후)

`.oculpm/planner/*.md` 의 대응 항목이 있으면: ① 상태 글리프 변경 — `[ ]` 할일 ·
`[~]` 진행중 · `[x]` 완료 · `[!]` 막힘 · `[>]` 이월 · `[-]` 폐기, ② 하단 managed
block 에 한 줄 append (기존 행 수정 금지):

```markdown
<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-31T14:03:00+09:00 | #item-id | claude-code | ~→x | journal/…/x.md | |
<!-- oculpm:plan-log end -->
```

- 항목은 한 줄 (`- [ ] 내용 {#id}` — `{#id}` 를 둘째 줄로 넘기지 말 것).
- `status:` 가 `active` 가 아닌 plan(`done`/`archived`)은 절대 수정 금지 — 새 plan 을 만든다.
- 새 plan frontmatter: `oculpm_plan: v1` + `id`(파일명과 동일 kebab) + `title` + `status: active` + `created`/`updated` + `owner`.

## 3. 문제 해결 문서 (요청 시에만)

사용자가 "옵션 비교/큰 계획을 정리하자"고 명시적으로 요청할 때만
`.oculpm/discussion/<slug>/discussion.md` 를 만든다: frontmatter
`oculpm_discussion: v1` + id/title/status(open)/created/updated/owner, 본문은
`## 문제 정의` (필수·최상단) → `### 방안 {#opt-id}` → `## 토의 / 메모` managed
block 표(append only) → 결론 시 `## 결론` + status: resolved. 진척 추적은 플래너의
일 — discussion 에 실행 로그를 쌓지 말 것.
