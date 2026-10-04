---
schema_version: 1
type: chore
slug: "ui-copy-leaks-dead-i18n-keys"
status: done
difficulty: low
created_at: "2026-10-04T21:12:24+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/branch/ReleaseNotesSheet.tsx"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
related: []
tags:
  - "i18n"
  - "ux"
  - "dead-code"
  - "mcp-tool"
---
[x] 화면에 새던 내부 코드명·반쪽 영어·이 저장소 전용 문구 정리 + 죽은 i18n 키 80개

## 무엇을
- 설정: "(W4 dogfooding fix)"·"(W4-PR3)" 같은 내부 작업 코드명이 사용자 화면에 있었다. "Inactivity timeout"·"Resume grace"·"timezone"·"idle"·"drift"·"baseline"·"SSOT" 를 사람의 말로 (ko/en).
- 브랜치 화면 릴리스 노트 시트가 **Ocul-PM 자신의** 릴리스 체크리스트("버전 6파일 · 랜딩 ko/en · docs/RELEASE.md")를 모든 사용자 프로젝트에 보여 주고 있었다 → 일반 문구.
- placeholder 예시가 이 저장소 작업명(fastembed 안정화·Changelog Export)이던 것.
- MCP 심볼릭 링크 거부 오류가 "a linked .oculpm is 기록하지 않습니다" 처럼 문장 중간에 언어가 바뀌던 것.
- 어디서도 부르지 않는 키 80개 (옛 시작 화면 home.* 19, 은퇴한 ACP 툴바, CodeMirror 문구 등). 동적 접두(`err.code.${…}` 등 24종)·플랫폼 변형(`__win`)은 판정에서 제외.

## 검증
옛 문구를 못박던 테스트 2개를 새 문구로. vitest 전체 초록, lint:i18n 초록.