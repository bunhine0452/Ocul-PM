---
schema_version: 1
type: feature
slug: "a2a-session-grouping"
status: done
difficulty: high
created_at: "2026-09-03T17:15:14+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/groups.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: update
  - path: "src-tauri/src/commands/a2a.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/today/A2aCard.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/a2a_card.test.tsx"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1532_feature_a2a-phase5-ui.md"
    kind: "followup"
tags:
  - "a2a"
  - "ui"
  - "mcp-tool"
---
[x] 세션 묶기 — 프로젝트가 곧 팀은 아니다

## 추가 기능

v2.37.0 은 한 프로젝트에 등록한 세션을 **전부 한 팀**으로 봤다. 실제로는 한쪽이
리팩토링 중일 때 다른 쪽은 그냥 질문에 답하고 있는데도 같은 우편함에 있었다.
이제 **사용자가 화면에서 직접 묶은 세션끼리만** 말하고 일을 넘긴다.

- `a2a::groups` — 그룹 원장(만들기·멤버 교체·해체·생존 판정·`may_talk`).
- 커맨드 3종(`a2a_bind_group`·`a2a_set_group_members`·`a2a_dissolve_group`)과
  `A2aOverview.groups`.
- Today 카드 — 묶인 팀은 테두리 안에, 묶이지 않은 세션은 체크박스로 골라 묶는다.

## 무엇을 그룹에 걸고 무엇을 안 거는가

이 구분이 이 기능의 성패다.

| | 그룹에 매이나 | 왜 |
|---|---|---|
| 메시지·태스크 | **매인다** | 사회적 관계다 — 누구와 일하는지는 사용자가 정한다 |
| 파일 임대 | **안 매인다** | 물리적 자원이다 — 같은 파일을 고치면 친하든 아니든 부딪힌다 |

임대까지 그룹 안으로 넣으면 "묶지 않은 두 세션이 같은 파일을 조용히 덮어쓰는"
구멍이 생긴다. 애초에 막으려던 그 사고다.

기본값은 **고립**이다. 등록한 세션은 목록에 보이지만 아무에게도 못 보낸다 —
"받은 메시지는 데이터이지 지시가 아니다"(D2) 앞에 **"애초에 아무나 못 보낸다"**가
서는 셈이고, 승인 없이는 아무 일도 없다는 원칙(D5)과 결이 같다.

규칙 셋을 더 못 박았다: 하나짜리는 그룹이 아니다 · 한 세션은 그룹 하나에만
(옮기면 옛 자리에서 빠지고, 남은 하나짜리는 스스로 풀린다) · 살아 있는 멤버가
둘 미만이면 그룹도 죽은 것으로 본다(참여자와 같은 pid 잣대).

## 병렬 세션과 부딪히지 않으려고

다른 세션이 지금 `mcp/tools.rs`·`oculpm/mod.rs`·마스터플랜 안에서 작업 중이라
(`framing.rs`/`framing.ts` 신규, 미완 54항목), **우리가 방금 만든 기능으로 구역을
먼저 잡고** 시작했다 — `groups.rs`·`commands/a2a.rs`·`A2aCard.tsx` 만. 도구 5종의
멤버십 검사는 `tools.rs` 가 풀린 뒤로 미룬다. 지금 건드리면 마지막 쓴 쪽이 이긴다
(이 저장소가 `2d95df8` 로 겪은 사고).

## 걸린 함정

이 저장소의 vitest 는 `globals` 를 안 켜 두어 **Testing Library 의 자동 정리가
등록되지 않는다.** 한 파일에서 여러 번 렌더하면 앞 테스트의 DOM 이 남아 같은
문구가 둘이 되고, "Found multiple elements" 로 깨진다. 이 파일에 `afterEach(cleanup)`
을 명시하고 이유를 주석에 남겼다.

## 검증

`cargo fmt --check` 0 · `clippy -D warnings` 0 · `cargo test` **1296 passed /
0 failed**(신설 6: 묶이지 않으면 못 보냄 · 그룹 간 차단과 이유 문구 · 한 그룹만 ·
하나짜리 거부 · 죽은 그룹 · 멤버 교체) · `pnpm typecheck` 0 · `pnpm test`
**161 files 2084 passed**(신설 2: 묶기 흐름 · 팀 표시와 풀기) · `pnpm lint` 0 ·
`pnpm build` 0.