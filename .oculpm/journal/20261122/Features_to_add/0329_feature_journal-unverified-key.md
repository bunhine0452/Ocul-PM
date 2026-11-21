---
schema_version: 1
type: feature
slug: "journal-unverified-key"
status: done
difficulty: low
created_at: "2026-11-22T03:29:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalHead.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_unverified_key.test.tsx"
    op: create
related: []
tags:
  - "일지-화면"
  - "journal"
  - "keyboard"
---
[x] 일지 화면: 검증 없는 것만을 u 키로 켠다

## 추가 기능
검증 없는 일지를 차례로 읽는 흐름(j → v → j)은 키보드로 되는데, 그 흐름에 들어가는 문인 「검증 없는 것만」 단추만 마우스였다. 일지가 많은 날 검증 없는 일지는 목록 곳곳에 흩어져 있어, 거르지 않으면 j 로 증거가 선 줄을 다 지나가야 한다.

- 일지 화면에서 `u` 가 「검증 없는 것만」 을 켜고 끈다. 단추와 같은 동작이다. 입력칸 안의 u 는 글자이고, 누르고 있어 되풀이된 키와 수식키 조합은 받지 않는다.
- 다 읽어 목록이 비면 「검증 없는 일지가 없어요. 볼 것이 없어요.」 가 선다. 예전엔 찾다 못 찾은 말(「조건에 맞는 일지가 없어요. (전체 기간 검색됨)」)이었다. 종류 필터 · 검색이 함께 걸렸거나 더 받을 쪽이 남았으면 예전 말 그대로다.
- 치트시트(⌘/) 일지 묶음과 단추의 툴팁이 그 키를 알린다.

## 동작 흐름
1. `JournalScreenV2` 의 컨테이너 keydown 이 `u` 를 듣고 단추와 같은 `toggleMissing` 을 부른다.
2. 켜지면 목록이 새로 서고 첫 줄이 골라진다(기존 자동 선택). `v` 로 읽으면 그 줄이 빠지고 같은 자리의 줄이 골라진다(기존 흐름).
3. 목록이 비었을 때의 문장은 「검증 없는 것만」 만 걸렸는지를 보고 고른다.

## 검증
- 하루 30건 · 검증 없는 둘 픽스처: `u` `v` `v` 키 셋으로 둘을 읽고 빈 목록의 문장까지 확인. 거르지 않으면 첫 검증 없는 일지까지 `j` 열 번, 둘째까지 열두 번이 더 든다.
- `npx vitest run src/__tests__/journal_unverified_key.test.tsx` → `Tests  4 passed (4)`
- `npx vitest run` (단축키 겹침 · 치트시트 · i18n · 일지 화면 스위트 열) → `Tests  140 passed (140)`
- `npx tsc --noEmit` exit 0 · `node scripts/check-file-sizes.mjs` → `✓ file size: clean`

## 메모
- 키 표기를 단추 안에 칩으로 세우지 않고 툴팁에 두었다. 목록 칸(320px)의 그 줄에는 한 칸이 더 설 자리가 없다.
- 설치본에서 눈으로 보지는 않았다. 두벌식 자판에서의 u(ㅕ)는 `readChord` 를 지나는 기존 키들과 같은 길이지만 이 키로 따로 시험하지는 않았다.
