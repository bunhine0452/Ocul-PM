---
schema_version: 1
type: chore
slug: release-v2-18-0
status: done
difficulty: low
created_at: "2026-08-24T18:11:00+09:00"
session_id: "manual-20260824-181100"
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
  - path: "src/features/settings/MobileSettings.tsx"
    op: update
  - path: "src/mobile/MobileApp.tsx"
    op: update
related:
  - "20260824/Chores/1026_chore_mobile-bridge-plan.md"
  - "20260824/Features_to_add/1613_feature_mobile-bridge-mb4-chat-power.md"
  - "20260824/Features_to_add/1753_feature_mobile-reskin-desktop-identity.md"
tags: [release, mobile]
---

[x] v2.18.0 릴리스 — 모바일 연동 베타 (Tailscale 폰 접속)

하루에 설계(플랜 mobile-bridge)부터 MB0~MB4 구현·리스킨까지 끝난 모바일
브리지를 **베타 명시**로 릴리스. 사용자 지시: "모바일 연동은 베타버전이라는
것을 명시하고 배포" + "전부 커밋해서 배포"(코드 사이드바 등 사용자 작업분 포함).

- 베타 표기: 설정 → 모바일 탭 BETA 배지+안내문(i18n ko/en), 폰 헤더 BETA
  배지(mob-beta), CHANGELOG·README·랜딩 전부 "(베타)" 명시.
- 5면 갱신: 버전 5파일(2.18.0) · CHANGELOG(증상→변화 서술) · README ko/en
  하이라이트(구 v2.17.0 은 🚀 해제) · landing 버전 6곳+변경 li+featureList
  +신규 FAQ(폰·태블릿)+기존 "외부 유출" FAQ 에 Tailscale 사설망 문장 보강
  (JSON-LD·details 각 2곳). 벤토 셀은 베타라 보류 — 정식화 때 3셀 한 줄로.
- plugin.html 무변경 (커맨드·도구·스킬 변화 없음 — plugin_manifest 게이트 초록).

## 검증

- 게이트: cargo 875 · pnpm typecheck/test 1295/lint/build 전부 exit 0 —
  버전 범프 후 재확인 (plugin_manifest 동기 포함).
- landing 잔존 2.17.0 grep — 역사 서술(업데이트 목록)뿐.
