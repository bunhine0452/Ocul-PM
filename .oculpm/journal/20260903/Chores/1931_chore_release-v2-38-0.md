---
schema_version: 1
type: chore
slug: "release-v2-38-0"
status: done
difficulty: medium
created_at: "2026-09-03T19:31:35+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
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
  - path: "landing/en/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "scripts/check-file-sizes.mjs"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "ci"
  - "mcp-tool"
---
[x] v2.38.0 릴리스 — 다섯 면에 다 적고, 얕은 체크아웃에서 죽던 게이트를 고쳤다

## 한 일

v2.38.0 을 다섯 면 전부에 적고 태그를 밀었다. 이번 판은 두 세션의 결과가 한 릴리스에 들어가서, 릴리스 노트에서 **양쪽을 같은 무게로** 다뤘다 — 세션 묶기(이쪽)와 신뢰 경계·원장 지문·판정 불가·세션 신원·규칙 근거(병렬 세션).

- **버전 5파일**: `package.json` · `tauri.conf.json` · `Cargo.toml` · `plugin.json` · `marketplace.json`
- **CHANGELOG**: 6줄, 그중 4줄이 병렬 세션의 작업
- **README ko/en**: 새 하이라이트 절 추가 + v2.37.0 절 강등
- **랜딩 ko/en**: 버전 문자열 6곳씩 · JSON-LD `featureList` · FAQ 2건(충돌 질문 갱신 + 「받은 텍스트를 그대로 믿나요」 신설) · 벤토 셀 · 변경 이력 항목 · `plugin.html` 배지 · `wiki-src/build.mjs` 재빌드
- 영문 랜딩에는 v2.37.0 때 **빠져 있던 벤토 셀 3개**(함께 일하는 중 · 구역 임대 · 작업 넘기기)도 이번에 함께 채웠다. 한글에만 있고 영문에 없던 상태였다.

## 중간에 잡은 것 — 로컬에서는 초록인데 CI 에서 죽는 게이트

릴리스 커밋을 밀자 프런트 잡이 터졌다. 병렬 세션이 새로 넣은 `scripts/check-file-sizes.mjs`(파일 크기 래칫)가 기준선으로 `HEAD^1` 을 꺼내는데, `actions/checkout` 기본 `fetch-depth: 1` 에는 **그 커밋이 없다**. 로컬에는 이력이 다 있어서 아무 신호도 없었다.

원인이 스크립트의 판단이 아니라 **입력의 부재**라, 두 곳을 고쳤다.

1. 프런트 잡 체크아웃에 `fetch-depth: 2` — 게이트에 필요한 기준선을 실제로 준다.
2. `resolveBaseRef` 가 `HEAD^1` 을 `rev-parse --verify` 로 확인하고, 없으면 **스택트레이스 대신 왜 못 잡았는지** 말한다.

조용히 통과시키지는 않았다. 원래 스크립트가 적어 둔 원칙("기준선을 모르는 채로 통과시키면 게이트가 있다는 착각만 남는다")이 옳고, 이번 실패는 그 원칙이 아니라 워크플로가 틀린 경우였다.

## 검증

- 로컬: `cargo fmt --check` · `cargo clippy --all-targets -D warnings` · `cargo test` · `pnpm typecheck` · `pnpm test`(162 파일 / 2109 통과) · `pnpm lint` · `pnpm build` 전부 exit 0
- 래칫 픽스는 `node scripts/check-file-sizes.mjs`(기준 HEAD)와 `OCULPM_FILESIZE_BASE=HEAD^1` 양쪽으로 돌려 확인, `file_size_ratchet.test.ts` 17개 통과
- main CI: 릴리스 커밋(612f48a)은 실패 → 픽스(212eedd)에서 두 잡 모두 success
- 태그 `v2.38.0` 푸시 완료, 랜딩 `vercel --prod` 배포