---
schema_version: 1
type: refactor
slug: "remove-notion-integration"
status: done
difficulty: medium
created_at: "2026-10-14T05:58:43+09:00"
session_id: "20261014-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4582e4ac-7f89-4e5b-9172-d92d9aa9650b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/notion.rs"
    op: delete
  - path: "src-tauri/src/commands/notion.rs"
    op: delete
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/secrets.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/notion.ts"
    op: delete
  - path: "src/features/oculpm/useNotionExport.ts"
    op: delete
  - path: "src/__tests__/notion_export_v2.test.tsx"
    op: delete
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/settings/tabs/DataTab.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/settings/settingsIndex.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/errors.ts"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "landing/api/notion/oauth/start.ts"
    op: delete
  - path: "landing/api/notion/oauth/callback.ts"
    op: delete
  - path: "landing/api/notion/oauth/exchange.ts"
    op: delete
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/privacy.html"
    op: update
  - path: "landing/wiki-src/pages.mjs"
    op: update
  - path: "landing/wiki-src/data.md"
    op: update
  - path: "landing/wiki-src/en/data.md"
    op: update
  - path: "landing/wiki-src/faq.md"
    op: update
  - path: "landing/wiki-src/en/faq.md"
    op: update
  - path: "landing/wiki-src/settings.md"
    op: update
  - path: "landing/wiki-src/en/settings.md"
    op: update
  - path: "landing/wiki/data.html"
    op: update
  - path: "landing/wiki/en/data.html"
    op: update
  - path: "landing/wiki/faq.html"
    op: update
  - path: "landing/wiki/en/faq.html"
    op: update
  - path: "landing/wiki/settings.html"
    op: update
  - path: "landing/wiki/en/settings.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "SECURITY.md"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "docs/README.md"
    op: update
  - path: "docs/notion-oauth-setup.md"
    op: delete
related: []
tags:
  - "notion"
  - "scope-freeze"
  - "egress"
  - "removal"
  - "mcp-tool"
---
[x] Notion 연동 걷기 — 커맨드 5개·OAuth 루프백·oculpm.com 교환 서버까지

## 동기
범위 동결(2026-10-08) 걷기 후보 `#remove-notion`. 사용자 판정: "안 쓰는 기능". 0.9k줄 + oculpm.com 교환 서버 의존 + OAuth 루프백 리스너 + 외부 송출 한 갈래를 유지하던 자리다. 밖에서 보기·공유하기는 `/oculpm:board`(claude.ai 아티팩트, 같은 날 일지)가 대신한다 — 동결 규칙의 "교체는 옛 경로 제거로 끝낸다".

## 변경 요약
- 백엔드: `notion.rs`·`commands/notion.rs` 삭제, `lib.rs` 커맨드 5개 등록 해제, bindings 재생성(Notion 0건).
- **남은 자격 증명 정리**: `secrets::retire_notion` — 기동 때 한 번 키체인 `notion_api_key`·설정 `notion_parent_page_id` 를 지우고 `notion_retired` 표식. 키체인 삭제가 실패하면 표식을 안 적어 다음 기동이 재시도(Linux Unavailable 은 성공으로 침). 코드가 사라진 뒤 쓰기 권한 토큰이 기기에 남지 않게.
- 프런트: 설정 데이터 탭 NotionSection, 일지 상세 「Notion 으로」 버튼, `useNotionExport`·`api/notion.ts`·테스트, i18n 키(설정·err·notion.*) 제거. 편집 버튼이 쓰던 `notion.blockedLoading` 은 `entry.blockedLoading` 으로 옮김. 안 쓰게 된 `Send` 아이콘 제거.
- 원장: egress_inventory 의 notion 두 자리·api.notion.com·www.notion.so 행 제거, oculpm.com 사유에서 OAuth 브로커 삭제, spawn 원장의 notion 기동 3자리 제거. `redact::CALL_SITE_FILES` 29→28.
- 랜딩: `landing/api/notion/oauth/*` 삭제(다음 vercel 배포에서 엔드포인트가 사라짐 — 옛 앱의 Notion 연결은 그때 끊긴다), 나가는 연결 "여섯 → 다섯"(ko/en 랜딩 FAQ·JSON-LD·privacy·wiki data/faq), 위키 설정의 Notion 절, build.mjs 재빌드. 릴리스 노트(과거 버전 항목)는 역사라 그대로.
- 문서: README ko/en 송출 목록, SECURITY.md 리스너 "둘 → 하나", CLAUDE.md 송출 목록, `docs/notion-oauth-setup.md` 삭제.

## 검증
- cargo fmt/clippy -D warnings 0, cargo test 2053 통과 0 실패(egress 원장·redact 카운트 포함), pnpm typecheck·lint(6게이트)·build 0, vitest 3322 통과.
- 실기기 미확인: 업그레이드 설치본에서 키체인 항목이 실제로 지워지는지(프롬프트 없이) — 이월.