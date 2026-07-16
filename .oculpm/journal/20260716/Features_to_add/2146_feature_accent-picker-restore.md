---
schema_version: 1
type: feature
slug: accent-picker-restore
status: done
difficulty: low
created_at: "2026-07-16T21:46:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/settings/SettingsPanel.tsx
    op: update
related: []
tags: ["settings", "appearance", "accent", "audit-fix"]
---

[x] 액센트 컬러 피커 복원 — v1.3.0 인프라(data-accent)는 살아있는데 UI 가 유실돼 있었다

## 추가 기능

감사 LOW #9: `colorTheme` 설정(6색, SettingsContext 가 `data-accent` 로 적용)은
동작하는데 바꿀 UI 가 없어 사용자가 액센트를 영영 못 바꿨다 (프리셋 테마 도입
때 유실 추정). 설정 → 모양 → 테마 섹션에 **6색 스와치 피커** 를 복원:
그린·블루·퍼플·오렌지·로즈·틸, 현재 색은 링+확대 표시.

## 동작 흐름

스와치 클릭 → `set("colorTheme", …)` → SettingsContext 가 `<html data-accent>`
교체 → tokens.css `[data-accent]` 팔레트가 즉시 적용. 프리셋 테마가 활성일 땐
프리셋이 자체 액센트를 갖고 오므로(data-accent 제거됨) 피커를 비활성화하고
"밝게/어둡게/OS 테마에서 적용" 안내를 띄운다.

## 검증

- typecheck / test(133) / lint / build exit 0. 스와치 색은 tokens.css 라이트
  기준값과 일치 (그린은 리스킨 후 #0e8a60).
- 실기기 색 전환 확인은 {#reskin-verify} 라운드에 포함.
