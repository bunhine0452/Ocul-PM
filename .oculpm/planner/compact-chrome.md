---
oculpm_plan: v1
id: compact-chrome
title: "화면 머리를 크롬 크기로 (2026-10-07)"
status: active
created: 2026-10-07
updated: 2026-10-07
owner: claude-code
---

사용자 판정 「모든 창의 헤더가 너무 커서 전문적으로 보이지 않는다」 — 전문 도구의 크롬 규격을 조사해 툴바·시트·이름표를 줄인다. 시각 언어(색·서체)는 그대로.

## 크롬 {#chrome}
- [x] 화면 툴바 52→44px · 좌우 22→16 · 제목 17→14 semibold (16화면 공통) {#toolbar}
- [x] 시트 모서리 20→12, 둥글기 램프 위쪽 l 14→12 · xl 20→14 {#radius-ramp}
- [x] 사이드바 프로젝트 이름 17→15 · 설정 섹션 제목 20→17 · 시작 탭 이어서 일하기 이름 26→20 {#name-tags}
- [x] Monaco 위젯 글자 7곳이 9/9 램프 재번호 뒤 옛 번호로 들어와 1~4px 크게 그려지던 것 {#monaco-ramp-regression}

## 합류·확인 {#ship}
- [x] PR #71 머지 (CI 초록 확인 뒤) {#merge}
- [ ] 실기기 확인 — 설치본에서 16화면 툴바·시트 모서리·편집기 우클릭 메뉴/자동완성·라이트·다크·글자 크기 설정 110% {#eyes-compact-chrome}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-07T20:41:52+09:00 | #toolbar | claude-code | ☐→x | .oculpm/journal/20261007/Features_to_add/2041_feature_compact-chrome-headers.md | PR #71 — 40/44 두 안을 찍어 44 로 |
| 2026-10-07T20:41:55+09:00 | #radius-ramp | claude-code | ☐→x | .oculpm/journal/20261007/Features_to_add/2041_feature_compact-chrome-headers.md | PR #71 |
| 2026-10-07T20:41:58+09:00 | #name-tags | claude-code | ☐→x | .oculpm/journal/20261007/Features_to_add/2041_feature_compact-chrome-headers.md | PR #71 |
| 2026-10-07T20:42:02+09:00 | #monaco-ramp-regression | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2041_bug_monaco-widget-font-ramp-regression.md | PR #71 — 770b7f88 의 옛 번호 7곳 |
| 2026-10-07T20:49:27+09:00 | #merge | claude-code | ☐→x |  | PR #71 rebase 머지 c92c39a9 — CI 3잡 conclusion success |
<!-- oculpm:plan-log end -->
