---
schema_version: 1
type: chore
slug: "release-v2-21-1"
status: done
difficulty: verylow
created_at: "2026-08-28T16:42:00+09:00"
session_id: "manual-20260828-164200"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
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
related:
  - ".oculpm/journal/20260828/Bugs/1627_bug_code-gutter-transparent-on-hscroll.md"
  - ".oculpm/journal/20260828/Bugs/1637_bug_node26-localstorage-shadow.md"
tags: ["release", "v2.21.1", "claude-code"]
---

[x] v2.21.1 릴리스 — 줄번호와 코드가 겹치지 않습니다

`docs/RELEASE.md` 의 다섯 면을 전부 적었다. 사용자에게 보이는 변경은 코드 화면
거터 겹침 수정 한 건이라 패치 판올림(2.21.0 → 2.21.1)이다.

- **버전 5파일** — package.json · tauri.conf.json · Cargo.toml ·
  plugin/oculpm/.claude-plugin/plugin.json · .claude-plugin/marketplace.json.
  Cargo.lock 의 `ocul-pm` 항목도 함께 따라간다.
- **CHANGELOG.md** — 맨 위 `## v2.21.1`(태그와 정확히 일치, release.yml 이 이 본문을
  릴리스 노트로 뽑는다).
- **README.md · README.en.md** — 양쪽 최상단에 `## 🚀 v2.21.1` 섹션 신설, 직전
  v2.21.0 은 🚀 를 떼고 아래로.
- **landing/index.html** — 버전 문자열 6곳(softwareVersion · nav-ver · ap-new NEW
  배지 · 히어로 다운로드 버튼 · CTA eyebrow · CTA 다운로드 버튼) + 변경사항 `<li>`
  1건 추가. FAQ·JSON-LD 의 `v2.21.0 부터는 …` 서술은 기능 도입 시점을 가리키는
  문장이라 그대로 둔다.

기능 추가가 없으므로 JSON-LD `featureList` · 새 FAQ · 벤토 셀은 건드리지 않았고,
플러그인 커맨드·도구·스킬 표면도 그대로라 `landing/plugin.html` 도 무변경이다.
**기존 FAQ 가 거짓이 되지 않는지**도 확인했다 — 이번 변경은 화면 결함 수정이라
FAQ 의 어떤 진술과도 충돌하지 않는다.

## 검증

버전 5곳을 먼저 고친 뒤 게이트를 돌렸다 (`plugin_manifest` 테스트가 앱 버전과의
동기를 강제하므로 순서가 중요하다): `pnpm typecheck` · `pnpm test`(116파일/1,327건)
· `pnpm lint` · `pnpm build` · `cargo test`(17개 테스트 바이너리 전부 ok) 모두
exit 0. `cargo test` 직후 `git diff src/lib/bindings.ts` 도 비어 있어 bindings 는
최신이다. `grep -n "2\.21\.0" landing/index.html` 로 이전 버전 문자열이 버튼·배지에
남지 않았음을 전수 확인했다.
