---
schema_version: 1
type: feature
slug: mobile-bridge-settings-tab
status: done
difficulty: low
created_at: "2026-08-24T11:23:00+09:00"
session_id: "manual-20260824-112300"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/settings/MobileSettings.tsx"
    op: create
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
related:
  - "20260824/Features_to_add/1118_feature_mobile-bridge-mb0-backend.md"
tags: [mobile, settings, i18n]
---

[x] 설정 '모바일' 탭 — 서버 토글·페어링 QR/코드·연결 기기 관리

## 추가 기능

- SettingsPanel 에 "모바일" 탭 신설(oculpm 뒤) — CodeSettings 와 같은 패턴으로
  Section/Field 프리미티브를 주입받는 별도 파일 `MobileSettings.tsx`.
- 서버 카드: 켜기/끄기(멱등 커맨드), 실행 중이면 http://100.x:42815/ 주소 표시,
  실패 사유(백엔드 문자열) 그대로 노출. 잠자기 한계 안내문 상시 표시 (플랜 D7).
- 페어링 카드(서버 실행 중에만): QR(uqr — 무의존성 SVG) + 6자리 코드 + 초
  카운트다운. 코드 생존 동안 5초 간격 기기 목록 폴링 — 등록되면 카드 자동 접힘.
- 연결 기기 목록: 이름·등록/마지막 접속 시각·해제 버튼(즉시 실효).
- i18n ko/en 20키, 로컬 Icons.tsx 에 Smartphone 추가 (lucide 경로 동일).

## 동작 흐름

설정→모바일→서버 켜기 → 페어링 시작 → 폰 브라우저(같은 tailnet)에서 QR 스캔
→ 표시된 페이지에서 코드 입력(MB3 에서 UI 제공, 현재는 /pair POST) → 기기 목록
에 나타나며 코드 카드 접힘.

## 검증

- pnpm typecheck / test 1278 / lint / build 전부 exit 0.
- Tailscale 미접속 상태에서 "no Tailscale interface found" 사유가 시작 실패
  문구로 표시되는 경로가 이 맥의 현재 기본값 (실기기 E2E 는 #mb3-verify).
