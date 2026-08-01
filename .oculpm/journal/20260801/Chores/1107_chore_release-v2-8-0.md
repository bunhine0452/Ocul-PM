---
schema_version: 1
type: chore
slug: release-v2-8-0
status: done
created_at: 2026-08-01T11:07:00+09:00
session_id: "manual-20260801-001127"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: CHANGELOG.md, op: update }
  - { path: package.json, op: update }
  - { path: src-tauri/tauri.conf.json, op: update }
  - { path: src-tauri/Cargo.toml, op: update }
  - { path: src-tauri/Cargo.lock, op: update }
  - { path: plugin/oculpm/.claude-plugin/plugin.json, op: update }
  - { path: .claude-plugin/marketplace.json, op: update }
  - { path: landing/index.html, op: update }
related: ["20260801/Features_to_add/1105_feature_skill-shop-tab.md"]
tags: [release]
---

# v2.8.0 릴리스 — 스킬 샵

## 무엇을

버전 동기 6지점(package.json·tauri.conf·Cargo.toml/lock·plugin.json·marketplace.json·
landing JSON-LD) 2.7.0→2.8.0, CHANGELOG v2.8.0 섹션(스킬 샵·카탈로그 25종·
플러그인 스킬 3종 v2·배달 게이트·/oculpm:help·인앱 플러그인 문서 탭), 랜딩
마케팅 카피 4곳(NEW 필·update-points·다운로드 버튼·하단 eyebrow) 갱신.

## 검증

전체 게이트(cargo test — 버전 동기 테스트 포함 · typecheck · lint · vitest ·
build) exit 0 확인 후 태그 푸시. release.yml 이 태그에서 CHANGELOG 해당 섹션을
릴리즈 노트로 추출해 .dmg 빌드·서명·업데이터 매니페스트를 발행.

## 메모

마켓플레이스는 main 을 서빙하므로 플러그인 변경(스킬 v2·배달 게이트·help)은
push 시점에 이미 배포 상태 — 앱 릴리스가 이번 태그의 본체.
