---
schema_version: 1
type: feature
slug: mobile-bridge-mb3-shell
status: done
difficulty: medium
created_at: "2026-08-24T16:01:00+09:00"
session_id: "manual-20260824-160100"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/mobile/MobileApp.tsx"
    op: create
  - path: "src/mobile/PairScreen.tsx"
    op: create
  - path: "src/mobile/EntryDetail.tsx"
    op: create
  - path: "src/mobile/storage.ts"
    op: create
  - path: "src/mobile/workday.ts"
    op: create
  - path: "src/mobile/mobile.css"
    op: create
  - path: "src/mobile/tabs/shared.tsx"
    op: create
  - path: "src/mobile/tabs/TodayTab.tsx"
    op: create
  - path: "src/mobile/tabs/JournalTab.tsx"
    op: create
  - path: "src/mobile/tabs/PlannerTab.tsx"
    op: create
  - path: "src/mobile/tabs/DiscussionTab.tsx"
    op: create
  - path: "src/mobile/tabs/AiTab.tsx"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "index.html"
    op: update
  - path: "public/manifest.webmanifest"
    op: create
  - path: "public/pwa-128.png"
    op: create
  - path: "public/pwa-256.png"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "src/__tests__/mobile_shell.test.tsx"
    op: create
related:
  - "20260824/Features_to_add/1519_feature_mobile-bridge-mb2-transport.md"
tags: [mobile, pwa, shell, i18n]
---

[x] 모바일 브리지 MB3 — 모바일 셸(하단탭 5) + 페어링 화면 + PWA

## 추가 기능

- **진입 분기** (main.tsx): 웹뷰가 아니면(폰 브라우저) 데스크톱 셸 대신 lazy
  `MobileApp`. `?desktop=1` 은 데스크톱-브라우저 스모크 탈출구. SettingsProvider
  는 올리지 않음(settings_get_all 이 화이트리스트 밖).
- **부트 게이트**: 토큰 없음/무효(→/api/ping 401) → PairScreen(6자리 코드 입력,
  기기명 UA 자동) → /pair → 토큰 저장. 프로젝트 1개면 자동 선택, 여럿이면 피커
  (마지막 선택은 mobile/storage.ts 로 영속 — 린트 allowlist 등재).
- **하단탭 5**: 투데이(오늘 일지+최근 플랜 활동) / 일지(날짜 넘김·상세 마크다운
  ·수동 작성 폼 — ManualEntryDraft, ASCII slug 파생) / 플래너(목록→상세, 체크
  토글 todo→in_progress→done 낙관 갱신, 비활성 플랜 읽기전용) / 논의(목록→상세,
  로그 한 줄 추가 — 데스크톱과 같은 mdEdit.appendLogRowOp 순수 헬퍼 재사용) /
  AI(자리 — MB4 에서 개방).
- **테마**: prefers-color-scheme → data-theme (데스크톱 SettingsContext 대체).
- **PWA** (#mb3-pwa): manifest.webmanifest + 아이콘 2종(src-tauri/icons 복사) +
  apple-touch-icon·standalone 메타. SW 없음 — 데이터가 맥 라이브라 오프라인 무의미.
- i18n ko/en 41키. 목록은 JournalEntrySummary, 상세만 전문 fetch (효율).

## 동작 흐름

폰 → http://100.x:42815 → 정적 앱 로드 → (비웹뷰) MobileApp → 토큰 게이트 →
프로젝트 → 탭. 플랜 체크·논의 메모·일지 작성이 맥의 .oculpm/ 에 그대로 기록되고
워처가 데스크톱 화면을 갱신한다.

## 검증

- vitest 1293 (신규 4: 무토큰→페어링 게이트·토큰 부트+탭 5·401→재페어링·플랜
  토글이 set_status(in_progress) 를 정확히 보냄). 테스트 문자열은 t() 경유로
  로케일 독립.
- pnpm typecheck / lint(스토리지·한글) / build 전부 exit 0. dist 에 manifest·
  아이콘 복사 + index.html 링크 확인. cargo 874 (백엔드 무변경 확인).
- 실기기 E2E(#mb3-verify)는 미실행 — Tailscale 연결 후 사용자 검증 필요.
