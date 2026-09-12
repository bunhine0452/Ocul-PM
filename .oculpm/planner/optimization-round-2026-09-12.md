---
oculpm_plan: v1
id: optimization-round-2026-09-12
title: "최적화 라운드 (2026-09-12) — 실측이 낸 확정 3건과 이월"
status: active
created: 2026-09-12
updated: 2026-09-12
owner: claude-code
---

코드 감사는 포화라 실행 중 프로세스(vmmap)·라이브 DB 사본(dbstat)·12일 로그 집계로 쟀다. 원장 docs/optimization/00-ledger.md §1.4~1.6 · §2.4~2.5 가 근거. 진행 상태는 여기.

## 확정 — 측정으로 잡은 것 {#confirmed}
- [x] 임베딩 아레나 피크 2.2G → 940M — `with_max_length(256)` + `EMBED_BATCH` 8 (perf_baseline M6, 속도 27→11 ms/청크) {#ort-arena}
- [x] `Db::compact()` 가 vec0 를 살아 있는 행으로 재구축 + VACUUM 뒤 WAL 절단 — 라이브 사본 553MB → 434MB (M5) {#vec0-holes}
- [x] `file_snapshots` 를 HEAD 밖 파일에만 — 전체 색인은 저장소당 `ls-tree` 1회(`HeadIndex`), 끝에 `retain_file_snapshots` 로 HEAD 복사본·고아 정리; 단일 파일은 `path_in_head` {#snapshot-git-dup}
- [x] IME 자동 덤프 예산 — 처음 3회, 이후 10분 1회, 억제 횟수 표기. 수동 ⌃⌥⇧I 는 예산 밖 {#ime-dump-budget}

## 이월 — 추정이거나 측정이 막은 것 {#carry}
- [x] 모델 로드 상주 ~640MB 의 정체 — drop 이 안 돌려주고 재로드가 +140MB 남긴다(M6). mmap 외부 데이터 · `use_device_allocator_for_initializers` 를 재 본 뒤에만 유휴 언로드를 다시 연다 {#embed-unload}
- [!] 실기기: 설치본에서 진단 탭 「정리」 눌러 DB 크기·의미 검색 정상 확인, 그 뒤 전체 재색인으로 스냅샷 81+12MB 회수 확인 {#eyes-compact}
- [-] (추정) `chunks.content` 97MB 는 파일 원문의 사본 — 줄 범위 디스크 재읽기로 대체할지, 의미 변화(삭제 파일)를 포함해 판단 {#chunks-content-dup}
- [-] (추정) 워처 `FileIdMap` 이 Create 마다 자라고 Delete 에서만 준다 — `target/` 프로젝트에서 장기 실행 후 MALLOC_SMALL 을 재 볼 것 {#fileidmap-growth}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-12T21:17:42+09:00 | #ort-arena | claude-code | ☐→x | .oculpm/journal/20260912/Refactors/2117_refactor_optimization-round-measured.md | M6: 2.2G→940M, 27→11ms/청크. d429ef4 |
| 2026-09-12T21:17:48+09:00 | #vec0-holes | claude-code | ☐→x | .oculpm/journal/20260912/Refactors/2117_refactor_optimization-round-measured.md | M5: 553→434MB, 블록 185→107. d429ef4 |
| 2026-09-12T21:17:54+09:00 | #snapshot-git-dup | claude-code | ☐→x | .oculpm/journal/20260912/Refactors/2117_refactor_optimization-round-measured.md | HeadIndex+retain_file_snapshots. 실제 회수는 다음 전체 색인 때. d429ef4 |
| 2026-09-12T21:18:00+09:00 | #ime-dump-budget | claude-code | ☐→x | .oculpm/journal/20260912/Refactors/2117_refactor_optimization-round-measured.md | dumpImeTraceAuto 3회+10분/1회. d429ef4 |
| 2026-09-12T22:32:19+09:00 | #embed-unload | claude-code | ☐→x | .oculpm/journal/20260912/Refactors/2232_refactor_embedder-idle-unload-malloc-cache.md | 정체=macOS malloc 대형 캐시. MallocLargeCache=0 재실행 + 5분 언로드, 유휴 645→38M. 31d5c75 |
| 2026-09-12T22:32:26+09:00 | #chunks-content-dup | claude-code | ☐→- | .oculpm/journal/20260912/Refactors/2232_refactor_embedder-idle-unload-malloc-cache.md | 기각 — 텍스트 검색(search_text LIKE)이 그 열을 훑는다. 원장 §3 |
| 2026-09-12T22:32:32+09:00 | #fileidmap-growth | claude-code | ☐→- | .oculpm/journal/20260912/Refactors/2232_refactor_embedder-idle-unload-malloc-cache.md | 기각 — M7: 20,000 Create 에 +3.8MB. 원장 §3 |
| 2026-09-12T22:32:38+09:00 | #eyes-compact | claude-code | ☐→! |  | 설치본이 이 코드가 아님 — 다음 릴리스 뒤. 추가 확인: `ps eww <pid> \| grep MallocLargeCache` 로 재실행 확인, 5분 뒤 로그 "embedding model unloaded" |
<!-- oculpm:plan-log end -->
