---
oculpm_plan: v1
id: fastembed-stabilize
title: "fastembed 안정화"
status: active
created: 2026-06-07
updated: 2026-06-07T14:03:00+09:00
owner: claude-code
---

## Phase A — 캐시 경로 안정화

- [x] fastembed 캐시 절대경로 고정 {#abs-cache} @claude-code·6/7
- [~] 패키징 빌드에서 모델 시드 검증 {#seed-verify}
  - [ ] 다른 머신 첫 실행 검증 {#fresh-machine}
- [!] 첫 실행 465MB 다운로드 UX {#dl-ux} ⟶ 진행 UI 부재
- [>] 모델 번들링 {#bundle} ⟶ 이월: 배포 라운드

## Phase B — 검색 품질
- [ ] 심볼/정확 검색 scope 실연동 {#search-scopes}

## 결정 (Decisions)

### Decision A — 캐시는 app_data_dir 절대경로 {#d-cache-abs}
- 잠금 2026-06-07 · claude-code
- 패키징 .app 의 CWD=/ 라 상대 캐시가 깨짐.
- 영향: #abs-cache, #seed-verify

<!-- oculpm:plan-log begin v1 -->
| 시각(ISO) | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-07T14:03:00+09:00 | #abs-cache | claude-code | ~→x | journal/20260607/Bugs/0902_bug_onnx.md | 절대경로 |
| 2026-06-07T14:05:11+09:00 | #seed-verify | user | ☐→~ | | 검증 시작 |
<!-- oculpm:plan-log end -->
