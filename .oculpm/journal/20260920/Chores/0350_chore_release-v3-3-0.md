---
schema_version: 1
type: chore
slug: "release-v3-3-0"
status: done
created_at: "2026-09-20T03:50:53+09:00"
session_id: "20260920-003"
agent:
  id: "claude-code"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] v3.3.0 릴리스 — 감독관의 오탐과 닮은꼴 계획 · 릴리스 게이트 4회째 통과

## 요약

오늘의 두 라운드(감독관 오탐·plan_create 재사용 권고·rust-analyzer 가드 / 실제 CSS 스크린샷 순회 결함 3건)를 v3.3.0 으로 릴리스했다. 릴리스 커밋 `e91708f3`, 태그 `v3.3.0`. docs/RELEASE.md 의 다섯 면 전부 적었다.

## 변경

- 버전 6파일 + 랜딩 ko/en 각 6곳: `node scripts/bump-version.mjs 3.3.0 --title-ko/--title-en`. `landing/plugin.html`·`landing/en/plugin.html` 의 `nav-ver` 는 손으로.
- `CHANGELOG.md` `## v3.3.0` — 증상→변화 서술형 두 문단(두 인스턴스 감시 절단 반복·계획 증식) + 항목 4.
- `README.md`·`README.en.md` 🚀 섹션 교체, 옛 3.2.2 는 일반 헤더로 강등.
- 랜딩 ko/en 변경 이력 `<li>` 추가. featureList·FAQ·bento 는 새 화면이 없어 손대지 않음.
- `node landing/wiki-src/build.mjs` → changelog.html·themes.html·privacy.html·sitemap.xml 재생성.
- `cargo test` 가 Cargo.lock 갱신, 34 스위트 ok. typecheck/test/lint/build 전부 0.

## 검증

- main 푸시 → CI run 35460226971 세 잡 success 확인 **후** 태그 단독 푸시.
- 릴리스 run 35460568879: gate(태그 커밋 CI 확인) success → build success → 검증·공개. 소요 약 42분(v3.2.2 와 동일).
- `gh release view v3.3.0`: `isDraft=false`, 노트 1,369자, 에셋 5개(`latest.json`·`.vsix`·`.dmg`·`.app.tar.gz`·`.sig`).
- 랜딩: `cd landing && vercel --prod --yes` → 라이브 `softwareVersion: 3.3.0`, changelog 앵커 110개.

## 남은 것

- `{#eyes-release-gate}` 의 마지막 조각(설치본 자동 업데이트가 3.2.2→3.3.0 으로 정상 교체되는지)은 실기기에서만 확인된다 — 4회째 파이프라인 통과 기록만 남긴다.