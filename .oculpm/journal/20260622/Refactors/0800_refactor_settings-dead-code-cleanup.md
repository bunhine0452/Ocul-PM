---
schema_version: 1
type: refactor
slug: settings-dead-code-cleanup
status: done
difficulty: low
created_at: "2026-06-22T08:00:00+09:00"
session_id: "20260622-m04"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src/lib/settings.ts
    op: update
  - path: src/features/settings/SettingsPanel.tsx
    op: update
related: []
tags: ["cleanup", "dead-code", "settings", "dev-report-followup"]
---

[x] 설정 죽은 코드 제거 — setMany + 코드에디터 설정군 (surgical-context-cleanup 일부)

## 동기

보고서 01 §1-C. `SettingsContext.setMany`(외부 호출 0, 완성된 미사용 public API)와 **코드 에디터 설정군**(uiDensity + editorFontFamily/Size/TabWidth/WordWrap/ShowLineNumbers/ActiveLineHighlight/IndentGuides)은 유일 소비자가 legacy `CodeEditor`였다 — 지금은 **UI 컨트롤만 살아있고 아무 동작 안 해 사용자 오인을 유발**. 0 consumer 확인 후 제거.

## 변경 요약

- `SettingsContext`: `setMany` 정의·타입·memo 참조 제거(`resetAll`이 쓰는 `settingsSetMany` 커맨드는 유지).
- `settings.ts`: KEYS·`Settings` 타입·DEFAULTS·`KEY_TO_FIELD` 역매핑에서 uiDensity + 7 에디터 키 제거, `UiDensity` 타입 export 제거. `uiScale`(앱 줌, 동작함)·`externalEditorCommand`(외부 에디터 열기, 동작함)는 유지.
- `SettingsPanel`: 죽은 "코드 에디터" Section 통째 제거.

## 검증

- DOM 적용처(data-density 등) 0, 외부 소비자 0 grep 확인. typecheck/test/lint/build 전부 exit 0(125 통과). 역매핑 누락분까지 typecheck 가 잡아 수정.

## 메모

- `#surgical-context-cleanup`의 **Settings 파트만** 완료. **WorkspaceContext reducer 외과수술**(activeView/sidePanel*/recentChanges/workdayKey 세터)은 **의도적 보류** — 로드베어링 컨텍스트 + 테스트로 핀된 마이그레이션 normalizer 와 깊게 얽혀 있고, 보고서 목록에 부정확성(예: `openDiffFor`는 죽은 코드가 아니라 활성 caller 2개)이 있어 항목별 신중한 검증이 필요. 토큰 절약·안전 우선 판단으로 별도 단위로 분리.
