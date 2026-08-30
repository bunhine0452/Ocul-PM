---
schema_version: 1
type: chore
slug: release-v2-24-0
status: done
created_at: 2026-08-30T12:29:00+09:00
session_id: "manual-20260830-122900"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: CHANGELOG.md
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
  - path: landing/index.html
    op: update
  - path: landing/plugin.html
    op: update
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/Cargo.lock
    op: update
  - path: plugin/oculpm/.claude-plugin/plugin.json
    op: update
  - path: .claude-plugin/marketplace.json
    op: update
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/tests/lite_w6_safety_net.rs
    op: update
related:
  - .oculpm/journal/20260830/Chores/1121_chore_fmt-clippy-gates.md
  - .oculpm/journal/20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md
  - .oculpm/journal/20260829/Features_to_add/1812_feature_firing-ledger-and-badges.md
tags: [release, audit-round]
---

[x] v2.24.0 릴리스 — 탭이 진짜 창으로 · 발동 배지 · 색인 정리 · 프로세스 생존 · 검토 루프 (개선점 감사 라운드 전체 + 8/29 탭 떼어내기 2건)

## 무엇

`docs/RELEASE.md` 다섯 면: 버전 5파일(+Cargo.lock) · CHANGELOG `## v2.24.0` · README ko/en 하이라이트 · 랜딩 버전 6곳 + 변경 `<li>` + featureList 4줄 + FAQ 「규칙이 실제로 읽히는지」(JSON-LD·details 양쪽) + 벤토 셀 「발동 배지」 + 「프로젝트 여러 개」 FAQ 에 v2.24.0 탭 떼어내기 문장 + featureList 의 「텍스트(FTS5)」를 「정확 일치」로 정정(FTS 는 이번에 폐기) · plugin.html 의 journal_write 설명(related·session_id·마스킹 알림).

## 검증

- 커밋 전 게이트 전부 exit 0(plugin_manifest 버전 동기 포함). 태그 단독 푸시 → `release.yml` run 33289002711 **success**, 에셋 4종(`.dmg` · `.app.tar.gz` · `.sig` · `latest.json`), 노트 2,300자. `vercel --prod` → `https://oculpm.com` 의 `softwareVersion` 2.24.0.
- **main 의 CI 는 한 번 붉었다**(run 33289001473, Rust 잡): 러너의 stable clippy 가 로컬 1.95 보다 새로워 이번에 켠 `-D warnings` 게이트가 두 lint 를 잡았다 — `format!("{}", &x)` 의 군더더기 참조(`tests/lite_w6_safety_net.rs`), `chunks_exact(4)` → `as_chunks::<4>()`(`src/tray.rs`). 고쳐 푸시한 `c3bb10e` 의 run 33290177941 은 **success**. 릴리스는 release.yml 이 테스트를 안 돌려 영향이 없었다.

## 메모

- 로컬 clippy(1.95) 가 CI 보다 낡았다 — Rust 를 고치고 밀기 전에 `rustup update stable` 로 맞추거나, 최소한 CI 의 첫 붉은 run 을 "새 lint" 로 읽을 것.
- 랜딩 빌드 로그에 `api/notion/oauth/*.ts` 의 `Buffer`/`process` 타입 오류가 찍힌다(빌드는 완료·배포 정상). 이전 릴리스부터 있던 것으로 `landing` 에 `@types/node` devDependency 를 더하면 사라진다 — 별건.
