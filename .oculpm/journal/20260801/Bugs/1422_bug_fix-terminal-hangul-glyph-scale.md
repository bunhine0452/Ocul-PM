---
schema_version: 1
type: bug
slug: "fix-terminal-hangul-glyph-scale"
status: done
difficulty: medium
created_at: "2026-08-01T14:22:26+09:00"
session_id: "mcp-20260801-142226"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/App.css"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/assets/fonts/D2Coding-term.woff2"
    op: create
  - path: "src/assets/fonts/D2Coding-subset.woff2"
    op: delete
  - path: "scripts/build-d2coding-subset.py"
    op: create
related: []
tags:
  - "terminal"
  - "font"
  - "hangul"
  - "xterm"
  - "mcp-tool"
---
[x] 터미널 한글이 라틴보다 크게 보이던 문제 — size-adjust 대신 폰트 advance 재작성

내장 터미널에서 한 줄 안의 한글이 라틴·숫자보다 눈에 띄게 크게 렌더돼 글자 크기가 뒤죽박죽으로 보였다.

## 발생 원인

터미널 폰트 스택은 라틴·기호·박스문자를 Menlo 에 맡기고 한글만 `D2Coding Term` 으로 그린다. xterm 은 셀 폭을 스택 선두 폰트로 재므로 셀 = Menlo advance = **0.60205em**(1233/2048)이고, 한글은 정확히 두 셀(1.2041em)을 차지해야 한다. 그런데 D2Coding 한글 advance 는 1.0em 이라 두 셀에 못 미친다.

2026-07-30 라운드에서 이 폭을 `size-adjust: 120.4%` 로 맞췄는데, **size-adjust 는 advance 뿐 아니라 글리프 아웃라인까지 20.4% 확대**한다. 폭 정합은 얻었지만 한글만 광학적으로 커진 것이 이번 증상이었다.

측정값 (13px 기준):

| | 한 advance | 한 글리프 높이 | H 글리프 높이 | 한/H 크기비 |
|---|---|---|---|---|
| 수정 전 | 15.650px (2.00 cells) | 14.01px | 9.48px | **1.478** |
| 수정 후 | 15.652px (2.00 cells) | 11.64px | 9.48px | **1.228** |

## 해결 방법

CSS 로는 글리프 크기를 건드리지 않고 advance 만 늘릴 방법이 없다. 그래서 폰트 파일의 `hmtx` 를 Menlo 그리드로 직접 재작성했다.

- `scripts/build-d2coding-subset.py` 추가 — 원본 D2Coding .ttc 에서 기존과 동일 커버리지로 서브셋한 뒤 advance 를 반각 500→602 / 전각 1000→1204 로 재작성하고, 늘어난 폭의 절반씩 나눠 글리프를 중앙 정렬한다. 아웃라인 크기는 원본 그대로.
- 컴포지트 안전성: 이 범위의 컴포지트는 전부 같은 폭 등급의 컴포넌트만 xy 오프셋으로 참조한다(스크립트에서 assert). 심플 글리프만 이동시키면 컴포지트는 컴포넌트를 따라 정확히 한 번 이동하므로 오프셋을 따로 건드리면 이중 이동이 된다.
- `D2Coding-subset.woff2` → `D2Coding-term.woff2` 로 교체. 힌팅 제거가 겹쳐 440KB → 279KB 로 오히려 줄었다.
- `App.css`: `size-adjust` 제거. `unicode-range` 는 서브셋이 실제로 가진 범위만 남겼다 — 조합형 자모(U+1100-11FF)·자모 확장(A960-A97F, D7B0-D7FF)은 D2Coding 원본에도 없어 선언해도 폴백으로 샜다. `font-weight` 도 파일 실제(단일 400)에 맞춰 정정 — 기존 `400 700` 선언은 굵은 한글의 합성 볼드를 막고 있었다.

## 검증

- 게이트 전부 exit 0: typecheck / test(49 files, 600) / lint / build.
- 실제 폰트 스택을 그대로 로드한 헤드리스 Chrome 페이지에서 canvas `measureText` 로 계측 — 한글 advance 는 수정 전후 모두 정확히 2셀(1.9996 → 1.9998)을 유지하고, 한/H 크기비만 1.478 → 1.228 로 정상화됨을 확인.
- 셀 그리드를 겹쳐 렌더한 스크린샷에서 한글·라틴·박스문자가 모두 셀 경계에 정렬됨을 육안 확인.