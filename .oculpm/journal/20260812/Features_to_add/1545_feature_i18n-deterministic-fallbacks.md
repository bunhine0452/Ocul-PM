---
schema_version: 1
type: feature
slug: "i18n-deterministic-fallbacks"
status: done
difficulty: medium
created_at: "2026-08-12T15:45:34+09:00"
session_id: "mcp-20260812-154534"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/content_lang.rs"
    op: update
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft.rs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "content-language"
  - "mcp-tool"
---
[x] LLM 을 안 거치는 산출물 영어화 — 결정적 요약·일지 폴백 문구

"AI 작성 언어" 를 English 로 두면 **LLM 산문은 영어인데 코드가 조립한 뼈대는 한국어**로 남던 구멍을 메웠다.

## 추가 기능

프롬프트에 출력 언어 지시를 붙이는 것만으로는 닿지 않는 자리가 둘 있다 — 모델이 손대지 않는 산출물이다.

**① `deterministic_markdown()` (commands/summary.rs)** — API 키가 없거나 LLM 호출이 실패하면 **이게 최종 산출물**이다. 스탠드업·PR 본문·주간 보고의 제목·섹션 헤더·타입 라벨·빈 상태 문구가 전부 한국어였다. 즉 키 없이 스탠드업을 뽑으면 설정과 무관하게 통째로 한국어였다.

**② 일지 폴백 문구 (oculpm/journal_draft.rs)** — LLM 이 `secondary`/`verification` 을 못 채웠을 때 코드가 끼워 넣는 산문(`(자동 초안 — 내용 미상)` · `자동 초안 — transcript 에서 검증 근거를 찾지 못함…`)과 강등 본문 전체. 영어 일지 한가운데 한국어 한 줄이 남았다.

## 어디까지 번역하고 어디서 멈췄나

**요약 마크다운은 헤더까지 번역했다.** 화면 표시 + 클립보드 복사용이고 `.oculpm` 에 저장되거나 다시 파싱되지 않는다 (`RetroScreenV2.runSummary` → `setSummaryResult` → `navigator.clipboard`). §4.5 의 "사용자가 복사해 붙여넣는 산출물" 예외에 해당한다.

**일지 섹션 헤더는 건드리지 않았다.** `## 발생 원인` · `## 검증` 등은 온디스크 규격(AGENTS.md §4)이라 파서·정직성 감사가 읽고 기존 일지가 전부 그 모양이다 — `schema_version` 범프와 마이그레이션이 필요한 별도 라운드다 (03-i18n.md §1).

그래서 PR 본문의 `` `## 검증` 참조 `` 는 영어 문장 안에서도 한글로 남는다 — **일지 파일의 헤더를 가리키는 인용**이라 그게 맞다. 테스트가 이 예외를 명시적으로 벗겨내고 검사한다(`md.replace("\`## 검증\`", "")`).

## Rust 에 사전을 들이지 않았다

`ContentLang::pick(ko, en)` 한 개로 갈랐다. 대상이 수십 개뿐이라 사전 인프라를 새로 만드는 비용이 이득을 넘는다. `Unset` 은 한국어 — 설정을 안 건드린 기존 사용자의 산출물이 조용히 바뀌면 안 된다.

## 회귀 없음을 테스트로 고정

기존 테스트 호출부에 `ContentLang::Unset` 을 넘겨 **출력이 한 글자도 안 바뀜**을 확인했다(520개 그대로 통과). 그 위에 영어 경로 5개를 추가했다 — 스탠드업/주간/PR 에 한글이 안 남는지, 빈 상태가 영어인지, 일지 폴백은 영어인데 규격 헤더는 유지되는지.

## 남은 것 (이번 범위 밖)

`plan_dispatch_prompt`(oculpm/planner/dispatch.rs)와 `build_retro_dispatch_prompt`(commands/retro.rs)는 **사용자가 읽고 터미널에서 실행**하는 프롬프트라 §4.5 가 명시한 번역 대상인데 아직 한국어다. 폴백/결정적 요약과는 다른 갈래라 이번 단위에 섞지 않았다.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 670통과 / **cargo test 525통과**(+5) / lint(남은 44 = 전부 테스트) / build.