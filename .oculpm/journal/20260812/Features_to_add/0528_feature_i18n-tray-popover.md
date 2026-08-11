---
schema_version: 1
type: feature
slug: "i18n-tray-popover"
status: done
difficulty: low
created_at: "2026-08-12T05:28:59+09:00"
session_id: "mcp-20260812-052859"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "tray"
  - "mcp-tool"
---
[x] 메뉴바 팝오버 영어화 — 상수 테이블 labelKey 패턴 재적용

메뉴바 팝오버 1파일 45건. allowlist 62 → 61. `tray.*` 키 45개.

## 추가 기능

프로젝트 스위처·세션 목록·오늘 요약·일지 목록/상세·플랜 목록/상세·상단바 설정 4토글·스탠드업 복사.

## 기존 키를 재사용하지 못한 이유 (일지 타입 배지)

`TYPE_LABEL` 은 일지 한 건에 붙는 배지라 **단수**여야 한다. 이미 있는
`journal.filter.*` 와 `retro.type.*` 는 둘 다 필터 칩이라 영어가 복수형
(`"Bugs"` · `"Features"`)이다. 그대로 쓰면 한 건짜리 배지에 "Bugs" 가 찍힌다.
한국어만 보면 값이 같아서 재사용하고 싶어지는데 영어에서 갈린다 — 새 키
(`tray.type*`)를 팠다.

## 상수 테이블 labelKey 패턴 (누적 9회째)

`TRAY_TOGGLES` 의 `label`/`hint: string` → `labelKey`/`hintKey: I18nKey`.
`key` 는 SQLite 설정 키(`tray.show_icon` …)라 판별자로 그대로 뒀다 — 표시
문구만 사전을 거친다. `TYPE_LABEL` 도 같은 모양.

## 함정

- `t` 섀도잉 2곳 (누적 31회) — `TRAY_TOGGLES.map((t) => …)` 가 두 번. `row` 로 개명.
- `useT()` 를 컴포넌트 5개에 넣어야 했는데, 여러 줄 시그니처
  (`}: { … }) {`)를 자동 삽입 스크립트가 **타입 리터럴 안**으로 밀어 넣어
  `Parameter declaration expected` 로 터졌다. typecheck 가 잡았고 되돌린 뒤
  본문 첫 줄에 직접 넣었다. 자동 삽입은 한 줄 시그니처에서만 안전하다.
- 툴팁이 모델 유무로 갈렸다(`agent · model · N개 파일` / `agent · N개 파일`).
  옵셔널 보간 대신 키 2개(`tray.entryTooltip*`)로 쪼갰다 — 조건부 조각을 문자열
  가운데 끼워 넣으면 영어 어순에서 구분자가 어긋난다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 655통과 / lint(남은 미번역 61) / build.