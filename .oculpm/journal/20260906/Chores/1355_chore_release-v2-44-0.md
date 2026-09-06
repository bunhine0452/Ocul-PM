---
schema_version: 1
type: chore
slug: "release-v2-44-0"
status: done
difficulty: medium
created_at: "2026-09-06T13:55:20+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
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
  - path: "package.json"
    op: update
related: []
tags:
  - "release"
  - "v3-surface"
  - "mcp-tool"
---
[x] v2.44.0 릴리스 — 기둥 2 를 다섯 면에 적는다

기둥 2(`v3-surface`, 32항목)를 v2.44.0 으로 내보낸다.

## 변경 요약

버전을 3.0.0 이 아니라 **2.44.0** 으로 잡았다. `v3-release` 플랜이 `{#release-300}` 을 소유하고 있고 그 플랜에 미완 62건(이번 라운드가 더한 육안 확인 부채 20건 포함)이 남아 있다. 기둥 1(`v3-record-integrity`)도 같은 방식으로 v2.43.0 으로 나갔다 — 기둥은 릴리스 단위이고 3.0.0 은 세 기둥이 다 선 뒤다.

`docs/RELEASE.md` 의 다섯 면을 전부 적었다.

- **버전 6파일** — `package.json` · `tauri.conf.json` · `Cargo.toml` · 플러그인 2개 · `marketplace.json`. `Cargo.lock` 도 함께 (cargo 가 갱신).
- **CHANGELOG.md** — GitHub 릴리스 노트의 유일한 소스. 헤더가 태그와 정확히 같아야 본문이 실린다.
- **README ko/en 양쪽** — 하이라이트 섹션 교체에 더해 **화면 구성 목록 자체**를 고쳤다. 이번 라운드가 이름 셋을 바꾸고(Diff→변경 · 코드 검색→검색 · 코드→편집기) 행 셋을 하나로 합치고 화면 하나를 더했으므로, 목록을 안 고치면 README 가 없는 화면을 안내하게 된다. 단축키 문단에도 ⌘번호 재배정을 적었다.
- **landing ko·en 각 6곳** — `softwareVersion` · `nav-ver` · `ap-new` · 다운로드 버튼 2곳 · CTA `eyebrow`. `plugin.html` 배지까지. 새 기능 표면도 양쪽에 손으로: JSON-LD `featureList` 5줄 · FAQ 1항목 · 벤토 셀 3개(`c-span2` 3 = 한 줄) · 변경 이력 `<li>`.
- **`node landing/wiki-src/build.mjs`** — 변경 이력·테마·개인정보·sitemap 재빌드(릴리스 95개, 최신 v2.44.0).

## 검증

`pnpm typecheck` · `pnpm test`(185파일 2,403건) · `pnpm lint`(6게이트, eslint 52/61) · `pnpm build` · `cargo test`(플러그인 매니페스트 버전 동기 포함) 전부 exit 0 을 **직접** 확인했다. `bindings.ts` 드리프트 없음.

태그를 밀기 전에 main 의 CI 가 그린인지 확인한다 — `release.yml` 은 테스트를 돌리지 않고 번들만 굽기 때문에, 붉은 main 에 태그를 밀면 깨진 빌드가 그대로 릴리스로 나간다.