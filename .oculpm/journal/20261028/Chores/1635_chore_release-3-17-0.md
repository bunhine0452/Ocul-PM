---
schema_version: 1
type: chore
slug: "release-3-17-0"
status: done
difficulty: low
created_at: "2026-10-28T16:35:41+09:00"
session_id: "20261028-006"
agent:
  id: "claude-code"
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
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
related: []
tags:
  - "release"
  - "ui-density"
  - "landing"
  - "mcp-tool"
---
[x] v3.17.0 릴리스 — 첫 실행부터 터미널까지, 시안 그대로 (같은 날 둘째 판)

## 동기
PR #108(밀도 라운드 3) 이 머지되어 시안 17장이 전부 main 에 있다. 사용자가 「릴리즈해」 — 같은 날 둘째 판 금지와 마이너 전 확인 날 규칙은 사용자 결정으로 넘겼고, 그 사실을 CHANGELOG 그 버전 절 첫 줄에 적었다(docs/RELEASE.md §0-2). v3.16.0 의 Windows·Linux 는 설치본 E2E 가 붉어 빠졌으므로(PR #107 이 고침) 이 판이 세 플랫폼을 다시 싣는 판이기도 하다.

## 변경 요약
- `node scripts/bump-version.mjs 3.17.0` — 6파일 + 랜딩 ko/en 각 6곳. 경고 셋(외부 리뷰 마이너 6개째 · 같은 날 2번째 · eyes 29건)은 막지 않으므로 그대로 진행.
- CHANGELOG `## v3.17.0` — 첫 줄에 같은 날 둘째 판·확인 날 없음 명시, 이어 첫 실행 → 시작 탭 → 오늘 → 일지 → 플래너 → 변경 → 브랜치 → 논의·스킬 → 터미널 → 설정 순 서술, 미구현(xterm 블록 접기 · CI 결과 · 수정 횟수) 명시.
- README ko/en 하이라이트 절 교체, v3.16 절의 「설정 「모양」」 → 「표시」(라운드 3 에서 탭 이름이 바뀜).
- 랜딩 ko/en — ap-new 문구, featureList 맨 위 한 줄(기존 줄의 Appearance → Display 도), 벤토 셀 3개(첫 실행 · 이어서 작업 · ⇧⌘J; c-span2 ×3 = 한 줄), update-points li. plugin.html ko/en 의 nav-ver.
- Cargo.lock 의 ocul-pm 판은 로컬 cargo 를 돌리지 않고 손으로 맞췄다(릴리스 때 로컬 빌드·테스트 금지 규칙).
- `node landing/wiki-src/build.mjs` → changelog.html(릴리스 131개) · privacy.html · sitemap.xml.
- 커밋 `e016c70e` → `git push origin main` → `git push origin v3.17.0`(태그 단독). release run 40650893193 이 떴고 meta 통과, gate 가 태그 커밋 CI 를 기다리는 중.

## 검증
- JSON-LD 두 파일 `json.loads` 통과, 랜딩에 남은 `3.16.0` 은 변경 이력 `<li>` 두 줄만(§4 grep).
- 코드 검증은 CI(ci.yml) 와 release gate 가 한다 — 로컬 게이트는 돌리지 않았다. 결과는 run 40650893193 의 conclusion 과 `gh release view v3.17.0 --json isDraft,assets` 로 확인한다.
- 랜딩 배포(`cd landing && vercel --prod --yes`)는 공개 뒤에(§5-1 4번).