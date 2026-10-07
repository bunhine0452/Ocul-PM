---
schema_version: 1
type: bug
slug: "automation-device-consent"
status: done
difficulty: high
created_at: "2026-10-07T10:10:04+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/automation/consent.rs"
    op: create
  - path: "src-tauri/src/commands/automation_consent.rs"
    op: create
  - path: "src-tauri/src/oculpm/automation/scheduler.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/watchers/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft/mod.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/config/schema.rs"
    op: update
  - path: "src-tauri/src/config/planner.rs"
    op: update
  - path: "src/features/settings/automation/AutomationConsentNotice.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/settings/automation/AutomationTab.tsx"
    op: update
  - path: "src/__tests__/automation_consent_notice.test.tsx"
    op: create
related:
  - ref: "20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md"
    kind: "followup"
tags:
  - "security"
  - "automation"
  - "external-review"
  - "mcp-tool"
---
[x] 남의 저장소 config 가 내 키로 배경 LLM 자동화를 켤 수 있었다 — 기기 동의

## 발생 원인

외부 보안 피드백 #1. 배경 자동화의 네 스위치(`agents.auto_reconcile`·`agents.auto_journal_draft`·`automation.schedules`·`automation.watchers`)와 정의(`.oculpm/automation/`)가 전부 저장소에 커밋되는 파일에 있다. 남이 만든 저장소를 앱에 추가하면 그 사람이 켜 둔 자동화가 **내 API 키로, 내 Claude Code 대화를 들고** 돌았다(일지 초안). 열 때 묻는 단계는 없었다.

리뷰가 짚은 우회도 확인했다: `oculpm_init` step 2.8(D2 다리)이 config 만 보고 비어 있는 배경 모델 슬롯에 대화 모델을 복사해, "배경 모델 미설정이면 조용히 스킵" 하는 게이트가 이 경로에서는 무력했다. 자동화 정의는 모델만 부르고(셸 실행 없음) 일일 예산 상한(≤1000)이 있으므로 영향은 과금과 대화 원문 송출이다 — 코드 실행은 아니다.

## 해결 방법

- `automation::consent` — 프로젝트 단위 기기 동의(SQLite `settings` 의 `automation_consent.<id>`, 저장소에는 없다). VS Code 작업 영역 신뢰와 같은 단위: 디스크 스위치는 "저장소가 원하는 것", 실제 발동은 동의가 정한다.
- 발동 쪽 세 문에만 건다: 스케줄러 틱·워처 규칙(정착·일지 삽입·레거시 `auto_reconcile`)은 `effective()` 를 지나고, 훅 일지 초안(`draft_for_session`)은 동의가 없으면 건너뛴다. 「지금 실행」처럼 사람이 누른 실행은 막지 않는다 — 클릭이 곧 의사다.
- 동의가 생기는 길 둘: 설정에서 꺼져 있던 스위치를 켜는 저장(`oculpm_set_config`, `turns_any_on`)과 오늘 화면 카드·자동화 탭 안내의 「이 기기에서 켜기」(`automation_consent_grant`). D2 시드도 동의 뒤로 옮겼다(`seed_wanted`). `oculpm_set_config` 는 oculpm.rs 크기 래칫 때문에 `commands/automation_consent.rs` 로 옮겼다(경로·바인딩 이름 불변).
- 선언적 설정 문서가 동의를 위조하지 못하게: 동의 키는 local-only(내보내기 제외)이고, 문서가 쓰려 하면 `device_consent` 로 blocked.
- 일부러 하지 않은 것: 스위치별 동의·정의별 승인. 동의한 프로젝트가 나중에(git pull) 켠 스위치는 다시 묻지 않는다 — VS Code 신뢰와 같은 한계로 받아들였다. 기존 사용자 일괄 승계도 하지 않았다(그러면 이미 추가된 남의 저장소도 승계된다) — 켜 두었던 프로젝트는 업데이트 뒤 오늘 카드에서 한 번 누르면 된다.

## 검증

- Rust: `consent` 단위 4(요청 목록·마스크·켜기=동의·DB 왕복과 프로젝트 격리) + 선언적 설정 1(동의 키 내보내기·적용 차단). 전체 1981 통과·실패 0, clippy 0.
- 프런트: `automation_consent_notice.test.tsx` 4(대기일 때만·허락 기록 후 사라짐·카드만 접힘·못 읽으면 침묵) + 기존 자동화 탭 21 그대로. 전체 3266 통과, lint·typecheck 통과.
- 실기기 미확인: 오늘 카드·자동화 탭 안내의 실제 모습, 허락 직후 배경 모델 시드 카드가 뜨는지.