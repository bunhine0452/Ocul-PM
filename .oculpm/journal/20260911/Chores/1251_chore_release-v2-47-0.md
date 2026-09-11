---
schema_version: 1
type: chore
slug: "release-v2-47-0"
status: done
difficulty: medium
created_at: "2026-09-11T12:51:24+09:00"
session_id: "20260911-006"
agent:
  id: "claude-code"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
related:
  - ref: "20260911/Features_to_add/1153_feature_blocked-reasons-round-4.md"
    kind: "followup"
  - ref: "20260911/Features_to_add/1125_feature_start-tab-ledger-redesign.md"
    kind: "followup"
tags:
  - "release"
  - "landing"
  - "changelog"
  - "mcp-tool"
---
[x] v2.47.0 릴리스 — 카드 무더기를 원장으로 (미커밋 3라운드 합류 + 비활성 이유 4차 + 5면)

## 동기

사용자 요청 「oculpm 의 개선사항들을 찾고 전부 진행한 다음에 릴리즈 발표해」. 워킹트리에는 병렬 세션이 남긴 미커밋 3라운드(편집기 IDE·일지 열람·시작 탭 원장, 35 수정 + 20 신규)가 있었고, v2.46.0 이후 미릴리스 커밋이 8개(플래너 시트·보드, 일지 원장, 계획 레일, 사이드바, 터미널 머리띠·핍·찍힌 폭 재생)였다.

## 변경 요약

1. **합류** — 미커밋 3라운드를 게이트 4종 초록 확인 뒤 한 커밋(0e45612)으로. 다른 세션이 살아 있지 않은지(mtime·프로세스) 먼저 봤다.
2. **개선** — 비활성 이유 4차(59곳, 래칫 69→10) · ESLint 경고 9→4 · critical-css 게이트가 rollup 공용 청크 이름(`App-*`→`blocked-*`)에 기대다 붉어진 것을 tokens.css 토큰 지문으로 고침(06284a1). 실기기 육안 항목(v3-release `eyes-*` 14건)과 `unify-chat` 의 ACP 제목 자리(IA 선택)는 눈이 필요해 이번 라운드 밖.
3. **릴리스 5면**(c20ce5f) — 버전 6파일 · CHANGELOG `## v2.47.0` · README ko/en 하이라이트 · landing ko/en 각 6곳 + 변경 이력 `<li>` + featureList + 편집기 FAQ 문장(details·JSON-LD) · plugin.html ko/en 배지 · `build.mjs` 재빌드(changelog 101 릴리스). 함정 하나: `2.46.0` 전수 치환이 FAQ 의 역사적 언급(「v2.46.0 에서 회고 화면을 걷어냈습니다」 4곳)까지 바꿔 되돌렸다 — 정상 카운트는 index.html 당 9.
4. **태그·배포** — main CI 3잡 success 확인 후 `v2.47.0` 단독 푸시 → release.yml success(37분) → 에셋 4개(dmg · app.tar.gz · sig · latest.json), 릴리스 노트 3,054자. `landing/ && vercel --prod` → oculpm.com ko/en/plugin 전부 2.47.0.

## 검증

- 커밋 전 게이트: typecheck · vitest 205파일 2,647건 · lint 6게이트 · build(critical-css 13선택자) · cargo test 1,597건 · clippy -D warnings 전부 exit 0 (직접 확인).
- 라이브: `curl oculpm.com` softwareVersion 2.47.0, `/changelog` 앵커 101, en·plugin 배지 2.47.0. 서명·공증은 dmg 를 받아 `codesign`·`spctl` 로 확인(결과는 세션 보고에).
- 남은 것: vercel 빌드 로그의 `api/notion/oauth/*.ts` TS2580(`@types/node` 부재) 경고는 이전부터 있던 것으로 배포는 READY — 별도 정리 대상.