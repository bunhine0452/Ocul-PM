---
schema_version: 1
type: refactor
slug: "ui-audit-words-glossary"
status: done
difficulty: medium
created_at: "2026-10-29T18:09:22+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_glossary.test.ts"
    op: update
  - path: "src/features/settings/prefsUi.tsx"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/features/settings/prefs.css"
    op: update
  - path: "src/__tests__/i18n_platform_words.test.ts"
    op: update
  - path: "src/__tests__/platform_keys.test.ts"
    op: update
  - path: ".oculpm/planner/ui-audit-20261029.md"
    op: create
related: []
tags:
  - "ui"
  - "i18n"
  - "ui-audit"
  - "mcp-tool"
---
[x] 화면 문구를 파일의 말로 — 단어표와 줄표 정리

## 동기

사용자 판정(10-29) 「UI가 전혀 심플하지 않고 사용자를 고려하지 않았어」 → 화면 검사(claude.ai/artifact/4rB4PAGWvy4gqTtCTRwZHW) → 계획 ui-audit-20261029 의 1단계. 에이전트가 돌린 명령과 결과 한 개념을 화면마다 증거·검증·검증 칸·명령 있음으로 불렀고, 「확인」 한 낱말이 세 뜻(확인할 것·확인함·확인 명령)이었고, 사람을 「사용자 몫」 으로 불렀다. 사전 1,248개 중 151개가 줄표(—)로 두 문장을 이었다.

## 변경 요약

- 사전 키 1,248개 중 코드가 부르지 않는 631개를 먼저 걷었다(4.0 에서 걷은 화면 문구). OS 판(`<키>__win` 등)은 원래 키에서 런타임에 만들어지므로 원래 키가 살아 있으면 판도 남긴다. 첫 시도는 이걸 빠뜨려 Windows 판을 지웠고 i18n_platform_words 가 잡았다.
- 단어표는 파일이 쓰는 말을 따른다. 일지 `## 검증`, 계획 `**확인 명령:**` 은 훅·파서 규격이라 그대로 두고 화면을 맞췄다(검사서가 처음 제안한 「검사·완료 검사」 에서 바꿈). 증거·검증 칸 → 검증, 판정 → 확인 명령 통과·실패, 확인함 → 읽음, 확인할 것 → 먼저 볼 것, 사용자 몫·결정 필요 → 내 차례, 기록 없는 변경 → 일지 없는 변경, 도는 중 → 실행 중, 플랜 → 계획.
- 줄표로 이은 값 65개를 한 문장 한 뜻으로. 끝의 원문 오류 `— {error}` 만 남긴다.
- 일지 상세에서 검증 칸이 없을 때 머리 칩과 상자 문장이 같은 「검증 없음」 이 되던 것 → 상자는 문장으로.
- 설정 칸 머리의 설명문 둘과 그것만 쓰던 PrefsCard `note` 를 걷었다.
- 게이트: i18n_glossary 에 옛 낱말 11개 + 값 안 「 — 」 금지.

## 검증

- 대조군: 게이트를 이 변경 전 사전에 돌리면 줄표 65건, 증거 10, 판정 9, 확인함 8, 플랜 7 이 걸린다.
- pnpm typecheck 0 · pnpm test 77 files / 937 passed · pnpm lint 0 · pnpm build 0 (커밋 c8af9715 · 04e3f07b)

## 메모

검사서의 「PlanItems.tsx:96 단계 이름 결함」 은 오판이었다. 하네스 픽스처가 항목 phase 에 id 를 넣었고, 실제 parse.rs 는 단계 이름을 넣는다. 검사서·계획(phase-name dropped)·메모리를 정정했다.