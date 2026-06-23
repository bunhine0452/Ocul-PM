---
schema_version: 1
type: feature
slug: retro-insight
status: done
difficulty: high
created_at: "2026-06-24T00:25:48+09:00"
session_id: "20260624-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/migrations/022_retro_insights.sql
    op: create
  - path: src-tauri/src/commands/retro.rs
    op: create
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: create
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/components/Sidebar.tsx
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["feature", "retro-insight", "회고", "oculpm", "dev-report-followup", "F4"]
---

[x] 회고/인사이트 생성 — overview 파이프라인 재활용 (F4)

## 추가 기능

타입별 일지·per-file diff·에러 사이클·에이전트 귀속·의존성 그래프라는 고유 종단 기록이 쌓이는데 시간축 종합이 0이었다(회고·주간요약 부재). 새 "회고" 화면을 추가했다: 기간(최근 7/14/30일)을 고르면 백엔드가 **결정적 신호**를 모아 즉시 보여주고, "회고 생성"으로 그 신호 위에 LLM 한국어 회고를 덧씌운다. 보고서가 지목한 자산을 그대로 연결 — `get_change_impact`(코드그래프 팬아웃), `AgentCount`/`DifficultyMix` DTO, `plan_ai_refresh` 의 provider/failover LLM 경로, `run_generation` 의 signature 캐시 패턴.

## 동작 흐름

- **신호(결정적, LLM 무관)**: `JournalCache::range_entries(since,until)` — 워크데이 범위(`workday >= ? AND <= ?`, 고정폭 8자라 사전식=시간순) 일지+`files_touched` 를 두 쿼리로 조인(N+1 없음). 순수 `aggregate()` 가 출시(완료 feature/refactor)·저항(error/bug + 2회 이상 등장한 문제 파일)·노력 핫스팟(최다 수정 파일 top 8)·에이전트 기여·난이도 분포로 가른다. 핫스팟마다 `get_change_impact` 1회로 역의존 팬아웃을 붙여 `is_hub`(≥3) 판정.
- **캐시/오래됨**: 신호를 blake3 로 해시(`signature`) → `retro_insights(project_id, range_key)` 캐시. 프런트는 `cached.signature !== signals.signature` 면 "오래됨" 배지(그 사이 일지·코드가 바뀜). `project_overviews` 와 동일한 lossy·재생성 가능 derivative — SSOT 아님.
- **커맨드 3개**: `retro_signals`(즉시 표시), `get_retro`(캐시 읽기), `generate_retro`(LLM 실행+캐시). 모든 신호는 이미 시크릿 마스킹된 SQLite 캐시에서 나와 추가 정제 불필요.
- **화면**: 5번째 MAIN_NAV 슬롯("회고", History 아이콘). 통계 카드 + 출시/저항/핫스팟/에이전트 섹션 + Markdown 회고. provider/model 은 planner 패턴(`default_provider`→`model_<p>`→`default_model`)으로 해결.

## 검증

- 백엔드 게이트: `cargo build` clean + `cargo test` 297 통과(신규 단위 6 — `range_entries` 범위/파일 부착, `aggregate` 출시·저항·반복파일·핫스팟정렬·에이전트share·난이도·빈입력).
- 프런트 게이트: typecheck/test(125)/lint/build 전부 exit 0. `bindings.ts` 는 `cargo test` 가 재생성(손편집 없음).
- 6항목 적대적 리뷰(서브에이전트): signature 결정성·범위 SQL·그래프 호출·오래됨 비교는 검증 통과. **기간 전환 중 write-back 레이스**(생성 중 기간 바꾸면 옛 회고가 새 기간 뷰를 덮음) should-fix 1건 발견 → `latestRange` ref 가드로 수정 후 재검증.

## 메모

- 한계(후속): ① 프런트 `ymd()` 가 OS 로컬tz 로 기간 계산 — 프로젝트tz 와 다르면 경계일 ±1 가능(F7a-B 와 같은 결의 정밀화 여지). ② "done 플랜 항목"은 v1 에서 미포함 — 완료된 feature/refactor 일지가 더 신뢰성 높은 출시 신호라 그것으로 대체(plan-log ts↔워크데이 매핑은 후속). ③ signature 가 그래프 팬아웃을 포함해 재인덱싱만으로도 "오래됨" 이 뜰 수 있음(의도적, advisory).
- 표면 추가·기존 불변. F4 는 보고서 매트릭스의 마지막 "Now/Next" 기능 항목.
