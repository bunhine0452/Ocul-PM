---
schema_version: 1
type: bug
slug: "mac-update-applying-overlay"
status: done
difficulty: low
created_at: "2026-11-19T16:44:30+09:00"
session_id: "manual-20261119-164430"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/lib/updater.ts"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/update_banner.test.tsx"
    op: update
related:
  - ".oculpm/journal/20261119/Bugs/1622_bug_windows-install-update-polish.md"
tags:
  - "업데이트"
  - "macos"
---
[x] 업데이트: macOS 도 바꾸는 동안 말없이 사라지지 않는다

## 발생 원인
사용자 요청(11-19): mac 에서도 업데이트할 때 받는 화면과 「업데이트할게요」 같은 화면.

받는 % 와 막대는 앞 작업(1622)에서 모든 OS 공통으로 들어갔다. 비어 있던 것은 그다음이다. Windows 는 설치 파일의 작은 진행 창이 「Ocul 을 새 버전으로 바꾸고 있어요」 라고 말한다. macOS · Linux 는 그런 창이 없다. 배너 단추가 「설치 중…」 으로 바뀌고, 곧바로 `relaunch` 로 창이 닫혔다.

## 해결 방법
- `UpdateApplying`: 깔기 · 재시작 동안 창 전체를 덮는 안내 카드다. 브랜드 스피너와 「Ocul 을 새 버전으로 바꾸고 있어요」 를 보이고, 아랫줄은 깔기 중 「잠시만 기다려 주세요.」, 재시작 직전 「끝나면 Ocul 이 저절로 다시 열려요.」 다. 문구는 Windows 진행 창 머리와 같다. `document.body` 로 포털하고, 배너와 설정 「업데이트」 줄이 같이 쓴다. 닫은 배너여도 보인다.
- `apply`: macOS · Linux 도 창 구성 저장 뒤 350ms 를 그린 다음 `relaunch` 한다(예전엔 Windows 만).
- 배너의 「설치 중…」 · 「다시 여는 중」 글은 걷었다(`update.installing` · `update.restarting` 키 삭제).

## 검증
- `vitest run` → `Tests 1105 passed (1105)` (깔기 중 → 재시작 문구 → relaunch 시험 추가) · `tsc --noEmit` exit 0 · lint 5관문 clean · eslint 0 errors
- macOS 실기기에서는 못 봤다(이 PC 는 Windows). polish-round #eyes-win-installer 와 같은 눈 확인이 남았다.
