---
schema_version: 1
type: chore
slug: osaurus-bench-design-and-plan
status: done
created_at: 2026-08-31T18:08:00+09:00
session_id: manual-20260831-180800
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: docs/20260831_osaurus-bench/00-master-plan.md
    op: create
  - path: docs/20260831_osaurus-bench/01-automation.md
    op: create
  - path: docs/20260831_osaurus-bench/02-provenance.md
    op: create
  - path: docs/20260831_osaurus-bench/03-themes.md
    op: create
  - path: docs/20260831_osaurus-bench/04-context-economy.md
    op: create
  - path: docs/20260831_osaurus-bench/05-config-plugins-import.md
    op: create
  - path: docs/20260831_osaurus-bench/06-landing.md
    op: create
  - path: .oculpm/planner/osaurus-bench-round.md
    op: create
related: []
tags: [design, benchmark, automation, themes, context]
---

[x] Osaurus 벤치마크 — 설계 문서 7편 + 플래너(9 Phase · 69 항목) 작성

## 무엇을 했는가

Osaurus(osaurus.ai — Dinoki Labs, Swift/MLX 로컬 AI 하네스, MIT)를 조사해 ocul-pm 이
가져올 설계 15개를 확정하고, `docs/20260831_osaurus-bench/` 를 SSOT 로 하는 설계
문서 7편과 실행 플래너를 만들었다.

조사 근거는 랜딩(`osaurus.ai`)과 `docs.osaurus.ai` 55면 중 watchers · schedules ·
memory · skills · themes · claude-plugins · orchestrator · projects · chat,
그리고 `github.com/osaurus-ai/osaurus` README 다.

## 핵심 판단

**기능을 옮기지 않고 구조와 UX 규약만 번역했다.** Osaurus 는 범용 AI 비서고
ocul-pm 은 기록기다. 예: Osaurus 의 "Obsidian 볼트 감시 → 편집이 멎으면 자동 커밋"
은 여기서 "작업 폴더 감시 → 손이 멎으면 일지 초안" 이 된다. 그 반대로 샌드박스
VM · 암호학적 identity · 이미지 생성 · computer-use · 음성 · 로컬 추론 서버 ·
텔레메트리는 명시적으로 범위 밖으로 잠갔다(Decision 6·7).

조사 중 코드베이스에서 확인한 사실 셋이 설계를 크게 바꿨다.

1. **자동화 축이 하나도 없다** — `grep cron` 무소득. 있는 건 옵인 배경 작업
   두 개(`auto_reconcile`·`auto_journal_draft`)뿐이고 각자 트리거·락·모델 선택을
   따로 들고 있다. 그래서 Phase 0 을 "셋을 합치는 토대" 로 세웠다.
2. **`aiContext.ts` 가 스스로 문제를 적어 두었다** — "이 블록은 매 메시지마다
   재조립돼 system 으로 다시 올라간다". 프롬프트 캐시가 매 턴 깨지고, 회상 신호와
   무관하게 규칙·플랜·일지가 항상 실린다. `digestRules` 의 2,500자 절단은 그
   압력의 흔적이고 한 번은 §5 시크릿 금지 조항이 통째로 잘렸던 이력이 주석에
   남아 있다. Osaurus 의 답(매니페스트 + 온디맨드 로드 + 세션 시작 시 동결)이
   그대로 처방이 된다 → Phase 5.
3. **`firing_ledger.rs` 가 이미 Insights 다** — 규칙 주입·스킬 발동을 결정론적으로
   관측하는데 배지로만 쓰인다. Osaurus 가 같은 데이터를 자동화 트러블슈팅의
   정식 경로로 지정한 방식을 가져와 진단 탭으로 승격시켰다.

## 문서 구조

| 파일 | 다루는 것 | Phase |
|---|---|---|
| `00-master-plan.md` | 범위·순서 근거·릴리스 매핑·위험 6·결정 6 | — |
| `01-automation.md` | Core Model · 잡 러너 · Schedules · 반응성 티어 6단 | 0·1·2 |
| `02-provenance.md` | 소스 배지 8종 · 활성 행 · 발동 원장 재포지셔닝 | 3 |
| `03-themes.md` | 테마 JSON(CSS 변수 이름 그대로) · 프로젝트 바인딩 | 4 |
| `04-context-economy.md` | 능력 매니페스트 · 회상 게이트 · 메모리 화면 | 5 |
| `05-config-plugins-import.md` | plan/apply · Claude 번들 · 딥링크 · 임포트 · 오프라인 | 6·7 |
| `06-landing.md` | changelog · themes · skills · privacy · automation 가이드 | 8 |

## 잠근 결정

D1 자동화 SSOT = 온디스크 마크다운 · D2 Core Model 없으면 자동화 정지 ·
D3 테마 JSON 키 = CSS 변수 이름 · D4 자동화 전부 옵인(schema_version 불변) ·
D5 오버레이 채팅 미복원 · D6 텔레메트리 미도입 · D7 범위 밖 명시.

## 검증

- 플래너 구조 검사: `- [ ]` 69줄 전부 `{#id}` 가 줄 끝에 있음(줄바꿈 0),
  중복 id 0, `## Phase` 9개, `{#…}` 총 85개(= 항목 69 + Phase 9 + Decision 7),
  frontmatter `oculpm_plan: v1` · `status: active` · plan-log 빈 블록 정상.
- 설계에 적은 코드 근거는 전부 저장소에서 직접 확인했다: `grep cron` 무소득 ·
  `grep "oculpm://"` 무소득 · `tokens.css` `[data-preset]` 5블록 ·
  `WatcherConfig.debounce_ms` 단일 숫자 · `AgentsConfig` 옵인 2종 ·
  `mcp/tools.rs` 도구 7종 · 마이그레이션 최신 `032` · 랜딩 `sitemap.xml` 구성.
- 코드 변경 없음(문서·플래너만) → 빌드 게이트 해당 없음.

## 메모

Phase 0→3 은 순차(잡 러너·발동 출처 위에 스케줄·워처가 얹히고 배지가 그걸
드러낸다), Phase 4~7 은 충돌 면이 갈라져 병렬 가능하다. Phase 8(랜딩)은 반드시
마지막 — 없는 기능을 미리 광고하는 것 자체가 정직성 위반이다.

가장 위험한 자리는 증폭 루프다. `watcher.rs` 는 지금 `.oculpm/journal/` 을
"이벤트 emit only" 로 통과시키는데, 자동화가 일지를 쓰면 그것이 다시 트리거가
된다. 트리거 원인 판정과 UI emit 판정을 분리하는 것이 Phase 2 의 필수 가드다.
