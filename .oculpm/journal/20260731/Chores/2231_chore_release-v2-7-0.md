---
schema_version: 1
type: chore
slug: "release-v2-7-0"
status: done
difficulty: low
created_at: "2026-07-31T22:31:02+09:00"
session_id: "mcp-20260731-223102"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "release"
  - "v2.7.0"
  - "mcp-tool"
---
[x] v2.7.0 릴리스 — 벤토 콕핏 홈 · 미기록 세션 신호 · 플러그인 커맨드 완성

## 작업 내용

버전 6곳(package.json · Cargo.toml · Cargo.lock · tauri.conf.json · plugin.json · marketplace.json) + 랜딩 JSON-LD 를 2.6.0 → 2.7.0 으로 범프. CHANGELOG v2.7.0 섹션, README 한/영 릴리스 섹션 교체, 랜딩(히어로 필 · 업데이트 밴드 불릿 · 받기 버튼 · 하단 CTA) 갱신.

릴리스 하이라이트:
- **벤토 콕핏 홈** — 메인 화면 전면 재구성 (이어서 일하기 타일 · 오늘의 흐름 · 초성 검색 · 키보드 완주 · 액센트 이중 해석 버그 수정 · home_brief 단일 호출)
- **미기록 세션 신호** (H3/H3b) + 상태줄 배지 (B1)
- **플러그인 커맨드 완성** — /oculpm:inception · next + oculpm.com/plugin 문서
- 플랜 컨텍스트 주입 · defer 원장 · 트레이 팝오버 스크롤

히스토리 참고: 메인 화면 뼈대는 d2a6f45(벤치 커밋)에 의도치 않게 동승했고, 검증 반영은 a7a1350 에 있다 — 두 커밋 메시지에 상호 참조를 남겼다.

## 검증

pnpm typecheck / test(411) / lint / build 전부 exit 0, cargo test 12개 스위트 전부 ok (버전 동기 게이트 plugin_manifest 포함) — 커밋 직전 직접 확인. 태그 v2.7.0 푸시로 release.yml(tauri-action) 빌드 트리거.