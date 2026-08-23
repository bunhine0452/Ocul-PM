---
schema_version: 1
type: chore
slug: release-v2-17-0
status: done
difficulty: low
created_at: "2026-08-24T03:45:00+09:00"
session_id: "manual-20260824-034500"
agent:
  id: claude-code
  version: claude-fable-5
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
  - "20260823/Bugs/2058_bug_watcher-dies-silently-no-live-refresh.md"
  - "20260823/Features_to_add/2037_feature_dispatch-inplace-and-agent-paste.md"
  - "20260823/Features_to_add/2343_feature_lock-handoff-newest-instance-wins.md"
  - "20260824/Features_to_add/0135_feature_code-tab-keyboard-ux.md"
  - "20260824/Features_to_add/0152_feature_nav-naming-ai-group.md"
tags: [release]
---

[x] v2.17.0 릴리스 — 실시간 갱신 자동 복구 · 디스패치 제자리 · 코드 탭 키보드 · 사이드바 정비

v2.16.0 릴리스 커밋에서 빠진 채 작업트리에 남아 있던 완결 작업 5덩어리
(워처 픽스 · 락 핸드오프 · 디스패치 · 설정 리팩터 · 템플릿 v9)를 일지 단위
커밋 4개로 나눠 싣고, 오늘 작업 2덩어리(코드 탭 UX · 사이드바 정비)를 더해
v2.17.0 으로 낸다. i18n(ko/en)은 6개 작업이 공유해, 버킷별 중간본을 만들어
커밋마다 해당 몫만 스테이징했다 (최종본은 원본과 바이트 동일 — cmp 검증).

핵심 동기: 2026-08-24 01:51 설치본에서 워처 사망 재현 확인 — 픽스가
릴리스에 실려야 실사용이 낫는다. 5면 갱신: 버전 5파일 · CHANGELOG ·
README ko/en · landing(버전 6곳 + featureList 2줄 + 업데이트 항목).

## 검증

- 게이트: cargo test 848 (pipefail exit 0) · pnpm typecheck / test 1277 /
  lint / build 전부 exit 0 — 버전 범프 후 재확인.
- landing 잔존 v2.16.0 문자열은 역사 서술(업데이트 목록·FAQ "부터는") 뿐.

## 메모

- 태그 푸시가 release.yml 에서 빌드·서명·릴리스 (로컬 빌드 안 함).
- 랜딩은 git 연동이 없어 `cd landing && vercel --prod` 로 별도 배포.
