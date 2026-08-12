---
schema_version: 1
type: chore
slug: release-v2-9-0
status: done
created_at: 2026-08-13T00:00:00+09:00
session_id: "manual-20260813-000000"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: true
difficulty: medium
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: CHANGELOG.md
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
  - path: landing/index.html
    op: update
  - path: .oculpm/planner/three-features-round.md
    op: update
related: []
tags: [release, v2.9.0, multi-window, tabs, landing]
---

[x] v2.9.0 릴리스 — 창과 탭

## 배경

`three-features-round` 의 Phase 0·1·1b 가 끝났다. 사용자가 실기기에서 수동 검증 항목(01-multi-window §7 9종 · 01b-chrome-tabs §7 11종)을 전부 확인했고, 게이트 5종이 통과해 릴리스로 묶는다.

## 무엇을 했나

`docs/RELEASE.md` 의 다섯 면을 2.8.5 → 2.9.0 으로 갱신했다.

1. **버전 3파일** — `package.json` · `tauri.conf.json` · `Cargo.toml`.
2. **CHANGELOG** — `## v2.9.0` 섹션. 릴리스 노트의 유일한 소스라 `release.yml` 이 쓰는 awk 추출을 실제로 돌려 본문이 나오는지 확인했다.
3. **README 양쪽** — `## 🚀 v2.9` 섹션 신설, 직전 v2.8 은 로켓을 떼어 압축. 단축키 문단에 창·탭 키(⌘T·⌘W·⇧⌘N·⇧⌘W·⌃Tab·⌘⌥←→)를 더했다.
4. **landing/index.html** — 버전 문자열 5곳 + JSON-LD `featureList` 한 줄 + FAQ 항목 + 벤토 `c-span3` 두 칸(창과 탭 · 시작 화면).
5. 플래너 — 검증 끝난 4항목 체크.

## 판단

**벤토를 `c-span3` 두 칸으로 넣었다.** 그리드가 6열이라 `c-span2` 를 하나만 더하면 줄이 1/3만 차 어그러진다. 새 기능이 이번 릴리스의 표제이기도 해서, 기존 `c-span3` 선례(자동 일지 · 로컬 diff)를 따라 한 줄을 통째로 썼다.

## 검증

- 게이트: typecheck · lint · vitest 738 · vite build(임계 CSS 가드 포함) · cargo test 604 — 전부 exit 0.
- 랜딩은 **헤드리스 크롬으로 실제 렌더해 눈으로 확인**했다. 정적 캡처에서는 `.reveal` 이 안 보이고 `min-height:100vh` 섹션이 창 높이만큼 늘어나 처음엔 빈 화면만 잡혔다 — 사본에 두 규칙을 무력화하는 스타일을 주입해서야 벤토가 보였다.
- JSON-LD 두 블록을 `json.loads` 로 파싱해 깨지지 않았는지 확인. 태그 균형도 확인.

## 함께 고친 것

렌더를 보다 **거짓이 된 문구 3건**을 찾았다. 이번 릴리스에서 트레이 회전 애니메이션을 없앴는데 랜딩의 메뉴바 셀은 여전히 "아이콘이 움직이고" 라고 말하고 있었고(감시 범위가 전체 프로젝트로 넓어진 것도 반영), 업데이트 밴드 eyebrow 는 `v2.5 → v2.8` 에 멈춰 있었다.

## 남은 것

- `{#tab-merge}` — 다른 창 스트립에 드롭해 합치기 (Rust 화면좌표 히트테스트). 2차로 미룸.
- 모바일 계획의 마이그레이션 번호를 028 로 옮겼다. 027 은 이번 라운드의 `project_appearance` 가 이미 썼다.
