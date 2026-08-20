---
schema_version: 1
type: chore
slug: release-v2-14-1
status: in_progress
difficulty: low
created_at: "2026-08-21T01:19:52+09:00"
session_id: "manual-20260821-011952"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
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
  - ".oculpm/journal/20260821/Bugs/0106_bug_migration-number-reuse-skipped-alter.md"
tags: [release, hotfix, landing, vercel]
---

[~] v2.14.1 긴급 릴리스 — Today 가 열리지 않던 한 건만 담아서

## 작업 내용

**한 건짜리 핫픽스.** [0106 일지](../Bugs/0106_bug_migration-number-reuse-skipped-alter.md)의 수정
(`23f0ba5`)만 담았다. v2.14.0 이 링의 「라인 변화」를 채우려고 더한 컬럼이 마이그레이션 **번호
충돌**로 일부 기기에서 만들어지지 않아, Today 를 열 때마다 화면이 통째로 비던 문제다. 사용자가
당장 못 쓰는 상태라 다음 묶음 릴리스를 기다리지 않고 바로 냈다.

**RELEASE.md 절차 완주** — 버전 5파일(+`Cargo.lock`) → 게이트 → `CHANGELOG.md` `## v2.14.1`
→ README ko/en 양쪽 → `landing/index.html` 버전 문자열 6곳(softwareVersion · nav-ver ·
NEW 배지 · 다운로드 버튼 2곳 · CTA eyebrow) + 변경 이력 항목 → 커밋(`60762dd`) → 태그 단독
푸시 → 랜딩 배포. 기능이 늘지 않은 패치라 JSON-LD `featureList` · FAQ · 벤토 셀은 건드리지 않았다.

**랜딩은 워킹트리가 아니라 HEAD 사본에서 배포했다.** `landing/` 에 다른 세션이 작업 중인 위키
WIP(수정 6건 + 신규 페이지 다수 + `en/`)가 있어서, 디렉터리를 그대로 `vercel --prod` 에 넘기면
미완성 페이지까지 함께 공개된다. `git archive HEAD landing` 으로 커밋된 상태만 꺼내고 `.vercel`
링크만 복사해 그 사본에서 배포했다 — 파일 목록이 HEAD 트리와 정확히 일치하는지 대조한 뒤 올렸다.
같은 이유로 커밋도 명시 경로만 stage 했다(`git add -A` 금지).

## 검증

- 게이트 전부 exit 0 을 **직접 확인** — `pnpm typecheck` · `pnpm test`(94파일 1080) ·
  `pnpm lint` · `pnpm build` · `cargo test`(631, 통합 스위트 포함).
- 태그 push 직후 `gh run list --workflow=release.yml` 에 **v2.14.1 run 이 실제로 떴다**
  (32390986823). `--tags` 를 쓰지 않아 옛 태그와 무관하게 push 이벤트가 발생했다.
- 랜딩 라이브 — `curl https://oculpm.com/` 에 `"softwareVersion": "2.14.1"` · 「v2.14.1 받기」 2곳.
- 커밋 뒤 `git status` 로 다른 세션의 위키 WIP 가 그대로 남아 있는지 확인 (쓸려 들어가지 않았다).
- 돌고 있던 기기의 DB 는 릴리스와 별개로 같은 두 `ALTER` 를 직접 넣어 이미 복구해 뒀다 —
  업데이트를 기다리지 않아도 Today 가 열린다.

## 메모

`status: in_progress` 인 이유는 이 글을 쓰는 시점에 **release.yml 빌드가 아직 도는 중**이기
때문이다(≈25분). 릴리스 노트 본문이 비어 있지 않은지와 에셋 4개(`.dmg` · `.app.tar.gz` ·
`.sig` · `latest.json`)는 빌드가 끝난 뒤 별도 검증 일지에 적는다 — 기존 일지는 고치지 않는다는
규칙 때문에 이 항목만 열어 둔다.
