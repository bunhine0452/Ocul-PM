---
schema_version: 1
type: error
slug: "release-3-15-0-blocked-recut-3-15-1"
status: done
difficulty: low
created_at: "2026-10-27T21:59:39+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
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
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
related:
  - ref: "20261027/Chores/2144_chore_release-v3-15-0.md"
    kind: "followup"
tags:
  - "release"
  - "ci"
  - "landing"
  - "mcp-tool"
---
[x] v3.15.0 태그가 release 게이트에 막힘 — CHANGELOG 첫 줄 인용 블록이 변경 이력 테스트를 깨뜨려 3.15.1 로 재발행

## 발생 원인

v3.15.0 을 로컬 게이트 없이 푸시했고(사용자 지시: 검증은 GitHub 에서), CI 의 vitest 가 `landing_pages.test.ts` 「본문이 잘리지 않았다 — 첫 릴리스의 문장이 그대로 있다」 에서 붉었다. 그 테스트는 CHANGELOG 맨 위 절 본문의 첫 24자(`*`·`` ` `` 만 뗀다)를 `changelog.html` 에서 찾는데, 3.15.0 절의 첫 줄을 **인용 블록**(`> 이 판은 …`)으로 써서 `> 이 판은 확인 날 ` 이 HTML 에 없었다(블록쿼트는 `<blockquote><p>` 로 렌더된다). 둘째 원인: 태그를 릴리스 커밋(f6a87289)에 걸고 일지 커밋(d2c3d342)을 그 뒤에 푸시해, CI 는 HEAD 에만 돌고 **태그 커밋에는 CI run 이 없었다** — release.yml 의 gate 는 그 커밋의 run 을 찾아 45분 기다린다. 두 가지가 겹쳐 release run 을 취소했다.

## 해결 방법

- 3.15.0 절의 첫 줄을 일반 문단(`**확인 날 없이 낸 판입니다** — …`)으로 바꾸고, 「v3.15.0 태그는 게이트에 막혀 공개되지 않았다, 내용은 같고 번호만 올렸다」 를 그 문단 끝에 적었다. 절 제목은 `## v3.15.1`.
- `bump-version 3.15.1` 로 6파일 + 랜딩 ko/en 6곳, README 하이라이트 제목·랜딩 변경 이력 `<li>`·plugin.html nav-ver 는 손으로, `build.mjs` 재생성, `cargo metadata --offline` 로 Cargo.lock.
- 태그는 **일지 커밋 뒤의 HEAD** 에 건다 — CI 가 도는 커밋과 태그 커밋이 같아야 gate 가 본다. v3.15.0 태그는 옮기지 않는다(RELEASE.md §0).

## 검증

- `pnpm vitest run src/__tests__/landing_pages.test.ts` 7건 통과(2초 — 같은 실패를 세 번 하지 않으려는 최소 확인). 나머지는 CI.
- 교훈 둘: CHANGELOG 절의 첫 줄은 인용 블록·표·코드로 시작하지 않는다 · 태그는 일지 커밋까지 포함한 HEAD 에.