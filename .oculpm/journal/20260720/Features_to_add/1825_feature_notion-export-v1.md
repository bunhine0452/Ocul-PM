---
schema_version: 1
type: feature
slug: "notion-export-v1"
status: done
difficulty: medium
created_at: "2026-07-20T18:25:15+09:00"
session_id: "mcp-20260720-182515"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/notion.rs"
    op: create
  - path: "src-tauri/src/commands/notion.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/__tests__/notion_export_v2.test.tsx"
    op: create
related: []
tags:
  - "claude-integration"
  - "notion"
  - "outbound"
  - "retro"
  - "mcp-tool"
---
[x] PR-CI7 Notion 내보내기 v1 — 키체인 토큰 + REST 페이지 생성, 회고/산출물 버튼

## 추가 기능

마스터플랜 D6 그대로 — 공식 Notion MCP 가 OAuth 전용이라 v1 은 **internal integration token + REST 직접**, 자동 동기화 없이 명시적 버튼만.

- **`notion.rs`**: 마크다운→Notion 블록 손실 허용 변환(헤딩1~3·불릿·번호·인용·코드펜스 언어 매핑·구분선, 표는 문단 폴백), Notion 제한 방어(요청당 children 100→95 상한+절단 안내 문단, rich_text 2000자→1900자 **문자 단위** 분할로 멀티바이트 안전), 페이지 URL/대시 유무 ID 를 대시 UUID 로 정규화(`normalize_page_id`), `users/me` 토큰 검증 + 페이지 생성(에러는 Notion `message` 추출).
- **커맨드 4종** (thin): `notion_status`(토큰 유무·부모 설정 — 네트워크 없음) / `notion_verify_token`(검증만, 저장 안 함) / `notion_set_parent`(정규화 후 SQLite settings) / `notion_export`(제목+마크다운→페이지 URL).
- **시크릿 규율**: 토큰 저장·삭제는 신규 코드가 아니라 **기존 `secret_set`/`secret_delete`(OS 키체인)** 재사용 — 검증 성공 후에만 저장. DB/localStorage 경유 없음.
- **설정 → 데이터 탭 `NotionSection`**: 연결 상태 배지(봇 이름)·검증 후 저장·연결 끊기·부모 페이지 URL 붙여넣기(정규화 왕복 표시).
- **회고 화면**: 회고 리포트(NarrativePanel)와 산출물 모달(스탠드업/PR/주간 보고)에 "Notion 으로" 버튼 — **토큰 없으면 버튼 자체 비노출**(수용 기준), 성공 시 토스트+`open_url` 로 새 페이지 열기.

## 동작 흐름

1. 설정 → 데이터: 토큰 입력 → `users/me` 실검증 → 성공 시에만 키체인 저장. 부모 페이지 URL → id 정규화 저장.
2. 회고: "Notion 으로" → `notion_export("회고 M/D–M/D", retro_md)` → 부모 아래 새 페이지 → URL 열기. 산출물 모달도 동일 (제목 = 산출물 종류+기간).

## 검증

- `cargo test` 382 passed — 신규 notion 5건: 블록 매핑·표/문단 폴백·코드 언어, 95 상한+절단 안내, 4000자 멀티바이트 1900자 분할, URL/ID 정규화, 페이지 payload 형태.
- `pnpm test` 173 passed — 신규 `notion_export_v2.test.tsx` 5건: 토큰 없음→버튼 비노출·내보내기 0건, 토큰 있음→제목/본문 계약+open_url, 검증 성공 후에만 secret_set(실패 시 무저장), 부모 정규화 왕복.
- typecheck/lint/build exit 0. 실 Notion 계정 왕복(페이지 실생성)은 Phase C 실기기 확인으로.