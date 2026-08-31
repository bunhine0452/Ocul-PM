---
schema_version: 1
type: chore
slug: release-v2-26-0
status: done
created_at: 2026-08-31T20:07:00+09:00
session_id: manual-20260831-200700
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: plugin/oculpm/.claude-plugin/plugin.json
    op: update
  - path: .claude-plugin/marketplace.json
    op: update
  - path: CHANGELOG.md
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
  - path: landing/index.html
    op: update
related:
  - .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md
  - .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md
  - .oculpm/journal/20260831/Features_to_add/1846_feature_agent-context-three-zones.md
  - .oculpm/journal/20260831/Features_to_add/1948_feature_agent-context-selfclean-loop.md
tags: [release, five-surfaces]
---

[x] v2.26.0 릴리스 — 두 라운드를 한 버전으로 · 5면 전부 채움

## 무엇을 했는가

같은 워킹 트리에서 **두 라운드가 동시에 끝나** 한 버전으로 나갔다.

| 라운드 | 내용 | 세션 |
|---|---|---|
| Osaurus 벤치마크 Phase 0+1 | 자동화 토대(Core Model·발동 출처·잡 러너·파일 SSOT) + 스케줄 자동화 | 이 세션 |
| agent-discipline 재설계 Phase 2+3 | 스킬·규칙 3존 화면 · 사건 진입점 5곳 · 규칙 다이어트·제안 3종 | 병렬 세션 |
| (곁들여) | 코드 화면 파일 트리 자동 갱신 | 병렬 세션 |

5면: 버전 **5파일**(package.json · tauri.conf.json · Cargo.toml · plugin.json ·
marketplace.json) · CHANGELOG `## v2.26.0` · README.md + README.en.md 하이라이트와
「화면 구성/Screens」의 스킬·규칙 항목 · landing/index.html 버전 문자열 6곳 +
JSON-LD `featureList` 3줄 + FAQ 1항목 + 벤토 셀 교체.

커밋 `70ccad9` → main 푸시 → CI 두 잡 `success` 확인 → 태그 `v2.26.0` 푸시 →
`landing/` 에서 `vercel --prod`.

## 검증

- 게이트 7종 exit 0 **직접 확인** (버전 5파일을 고친 뒤 다시 돌렸다 — `plugin_manifest`
  테스트가 앱 버전과 플러그인 두 파일의 동기를 강제한다): typecheck · test · lint ·
  build · cargo test · clippy `-D warnings` · fmt --check.
- CHANGELOG 추출을 release.yml 과 **같은 awk** 로 확인 — 헤더가 태그와 어긋나면 릴리스
  본문이 빈 채로 나간다.
- 태그는 **main CI 가 초록인 것을 잡 단위 `conclusion` 으로 확인한 뒤** 밀었다
  (release.yml 은 테스트를 돌리지 않고 번들만 굽는다).
- 랜딩 라이브 확인: `curl https://oculpm.com` 이 `v2.26.0` 을 표시.
- 커밋 내용 확인: 78파일, 민감 파일(`.env`·키·인증정보) 유입 0, 워킹트리 잔여 0.

## 메모

**`git add -A` 를 의도적으로 썼다.** 평소 병렬 세션 트리에서는 금지하는 방식이다
(2d95df8 사고 — `-A` 가 남의 WIP 를 쓸어 담았다). 이번엔 사용자가 "두 라운드 함께"
를 고른 것이 곧 범위였고, 미리 (a) 트리가 90초간 변경 없음 (b) 병렬 세션 플래너가
`status: done` 이고 게이트 그린을 확인했다. 그래도 커밋 뒤 파일 목록을 되짚어
민감 파일 유입을 확인했다.

**커밋을 라운드별로 가르지 못했다.** 공유 파일(`lib.rs`·`bindings.ts`·`ko/en.ts`·
`Icons.tsx`)에 양쪽 변경이 섞여 있어, 경로로 나누면 첫 커밋이 반드시 빌드가 깨진다
(`lib.rs` 가 양쪽 커맨드를 등록하는데 한쪽 구현만 담기므로). 인덱스 수술
(`GIT_INDEX_FILE` + `commit-tree`)의 값어치가 없다고 보고 한 커밋에 담되 메시지에
두 축을 갈라 적었다.

**개인 메모의 색인 줄이 낡아 있었다.** 메모 본문은 "버전 5파일 · 랜딩 6곳" 으로
정확했는데 그 위 한 줄 요약(`MEMORY.md` 색인)만 "3파일 · 5곳" 에 멈춰 있었다. 요약만
보고 갔으면 `plugin.json`·`marketplace.json` 과 다운로드 버튼 하나를 놓쳤을 것이다 —
착수 전에 `docs/RELEASE.md` 를 직접 편 것이 실제로 이득이 됐다. 색인 줄은 고쳤다.

릴리스 빌드(release.yml)는 태그 푸시로 시작됐고 서명·번들·릴리스 본문 생성은 그쪽이
맡는다. Phase 2(Watchers)는 v2.27.0 으로 나간다.
