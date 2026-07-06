---
schema_version: 1
type: feature
slug: generate-summary
status: done
difficulty: high
created_at: "2026-07-06T22:52:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/summary.rs
    op: create
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/llmTarget.ts
    op: create
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["v2-release", "U10", "C1", "standup", "pr-description", "llm"]
---

[x] U10 스탠드업·PR 본문·주간 보고 생성 (C1) — 일지를 매일 쓰는 산출물로

## 추가 기능

- **`oculpm_generate_summary(project_id, since, until, style, provider?, model?)`** — `style ∈ {standup, pr_description, weekly_status}`. 데이터는 회고(F4)와 동일한 `range_entries` 캐시 경로(R1 마스킹 상속) + 신규 `Db::list_open_plan_items`(활성 플랜의 todo/in_progress/blocked, 최근 갱신 플랜 우선).
- **항상 동작 원칙**: provider/model 미지정 또는 LLM 실패 시 **결정적 마크다운 폴백** (`used_llm=false` + `note` 로 사유 정직 표기). 스타일별 결정적 생성기: 스탠드업(한 일 타입 그룹핑/오늘 할 일/막힘), PR(변경 요약/주요 변경 파일 entry-당-1회 카운트/검증), 주간(출시·마찰 카운트/하이라이트/다음 주).
- **LLM 경로**: retro 와 동일한 provider 추상화(`llm::create` + keychain), 스타일별 한국어 시스템 프롬프트, 입력 60건 캡, 코드펜스 관용 처리.
- **UI 진입점 2곳**: ① 회고 화면 "산출물" 드롭다운(3종) → 결과 모달(마크다운 프리뷰 + 클립보드 복사 + used_llm 표시), ② Today 툴바 "스탠드업 복사" 원클릭(어제~오늘, 즉시 클립보드+토스트). provider/model 해석은 신규 `resolveLlmTarget()`(retro 규칙 재사용).

## 동작 흐름

아침에 Today 열고 "스탠드업 복사" → 어제 한 일(일지)+오늘 할 일(플랜)+막힘이 마크다운으로 클립보드에 → Slack 에 붙여넣기. PR 올릴 땐 회고 화면에서 기간 잡고 "PR 본문".

## 검증

- Rust 단위 테스트 4개 (결정적 생성기): 스탠드업 섹션·todo/blocked 분리, PR 파일 카운트(entry 당 1회), 주간 카운트 라인, 빈 기간 유효 마크다운. cargo **339 passed / 0 failed**.
- 프런트 게이트: typecheck=0 / test=0 / lint=0 / build=0.
