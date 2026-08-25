---
schema_version: 1
type: refactor
slug: "settings-panel-tabs"
status: done
difficulty: low
created_at: "2026-08-25T20:56:00+09:00"
session_id: "manual-20260825-205600"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/settings/tabs/ui.tsx"
    op: create
  - path: "src/features/settings/tabs/AppearanceTab.tsx"
    op: create
  - path: "src/features/settings/tabs/LlmTab.tsx"
    op: create
  - path: "src/features/settings/tabs/IndexingTab.tsx"
    op: create
  - path: "src/features/settings/tabs/GraphTab.tsx"
    op: create
  - path: "src/features/settings/tabs/DataTab.tsx"
    op: create
  - path: "src/features/settings/tabs/DiagnosticsTab.tsx"
    op: create
  - path: "src/features/settings/tabs/UpdateTab.tsx"
    op: create
related: ["20260825/Refactors/2052_refactor_acp-conversation-children.md"]
tags: ["refactor", "frontend", "react", "settings"]
---

[x] SettingsPanel 8개 탭을 tabs/ 로 분리 — 1,871 → 264줄

## 동기

외부 리뷰가 지적한 프런트 비대 파일 둘 중 두 번째. 탭 8개가 공용 프리미티브와 함께
한 파일에 있었다. AcpConversation 과 달리 **탭 경계가 이미 함수 단위로 서 있어**
분리가 기계적이다.

## 변경 요약

| 파일 | 줄 | |
|---|---|---|
| `AppearanceTab.tsx` | 550 | 테마·강조색·언어·터미널 폰트·메뉴바 (8선언) |
| `DataTab.tsx` | 326 | 내보내기·Notion 연동·초기화 (2) |
| `LlmTab.tsx` | 263 | 공급자·모델·키·폴백 체인 (1) |
| `UpdateTab.tsx` | 167 | 버전 확인·설치·과거 패치노트 (3) |
| `IndexingTab.tsx` | 151 | 임베딩·청킹·자동 색인 (1) |
| `ui.tsx` | 127 | Section·Field·Toggle·NumberSlider·Stat·secretName (6) |
| `DiagnosticsTab.tsx` | 114 | 환경 정보·피드백 이슈 (3) |
| `GraphTab.tsx` | 33 | 그래프 렌더 설정 (1) |

남은 `SettingsPanel.tsx` 264줄은 `TabId`·`TABS` 레지스트리·`SettingsPanelProps`·본체다.

`NotionSection` 은 `notion_export_v2.test.tsx` 가 `@/features/settings/SettingsPanel`
경로로 임포트한다. 테스트를 고치는 대신 **SettingsPanel.tsx 에서 재수출**해 외부
표면을 문자 그대로 유지했다.

## 검증

- **선언 집합 동일** — 정렬 비교 diff 없음, **29개 그대로**.
- **테스트 동일** — vitest 113파일 **1,303 케이스 전부 통과**.
- typecheck · lint · build 전부 exit 0. typecheck 는 **첫 시도에 에러 0**.

## 메모

AcpConversation 추출에서 쓴 스크립트를 JSON 설정을 받는 범용 도구로 일반화했다
(`원본 임포트 블록 파싱 → 대상별 필요한 심볼만 재구성` + 상대경로 깊이 보정 +
구간 겹침 assert). 그 덕에 이번엔 임포트 오류가 한 건도 없었다. 다음 단계
[#acp-extract-hooks] 는 성격이 달라 이 도구를 못 쓴다 — 훅은 서로의 클로저를 잡고
있어 기계적 이동이 안 되고, 그래서 [#frontend-regression] 특성화 테스트가 먼저다.
