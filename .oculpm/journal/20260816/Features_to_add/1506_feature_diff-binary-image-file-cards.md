---
schema_version: 1
type: feature
slug: "diff-binary-image-file-cards"
status: done
difficulty: medium
created_at: "2026-08-16T15:06:25+09:00"
session_id: "mcp-20260816-150625"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/git.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/diff/BinaryFileView.tsx"
    op: create
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/PatchView.tsx"
    op: update
  - path: "src/features/diff/diffParse.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
  - path: "src/__tests__/lite_w6_safety_net.test.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "diff"
  - "binary"
  - "image-preview"
  - "ux"
  - "mcp-tool"
---
[x] 변경 diff 완성 라운드 — 이미지·바이너리 파일 카드/프리뷰 + 버그 4건

## 추가 기능

사용자 도그푸딩 피드백: "사진 파일도 diff 에 보여서 UX 가 좋지 않다 — 사진/기타 파일은 파일대로, 코드는 코드대로." 변경 diff 화면을 온전한 기능으로 완성하는 라운드.

- **바이너리/이미지 = 파일 카드**: `compute_diff` 가 새 `DiffSource::Binary { is_image, old_size, new_size }` 를 내려주고, 프론트 `BinaryFileView` 가 파일 카드(종류·이전/현재 크기·delta 칩)로 렌더. 감지 경로 3중: ① 이미지 확장자(png/jpg/gif/webp/avif/bmp/ico/tiff/heic — svg 는 텍스트 diff 가 유용해 제외) 선판정, ② `git diff` 의 "Binary files … differ" 안내 감지(tracked 바이너리), ③ 스냅샷/디스크 앞 8000 바이트 NUL sniff(git 휴리스틱, untracked·비 git 프로젝트).
- **이미지 이전/현재 프리뷰**: 새 커맨드 `diff_binary_preview` 가 baseline 에 맞춰 이전(HEAD 블롭→스냅샷 폴백 / last_commit 은 HEAD~1)·현재(디스크 / HEAD) 바이트를 base64 로 반환(16MB 상한, `secure_join` 경로 방어). 프론트는 체커보드 밑판 위에 두 장을 나란히 — 투명 PNG 도 식별 가능. `git show` 는 `run_git` 의 lossy UTF-8 을 우회하는 바이너리 안전 `show_file_bytes` 로.
- **실제 라인 번호**: 거터가 hunk 마다 1부터 세던 가짜 번호였던 것을 `parseHunkHeader` 로 `@@ -a,b +c,d @@` 를 파싱해 실제 파일 번호로 (unified + split 양쪽, split 은 좌=old/우=new 각자 카운트).
- **+N/−M 라인 요약 칩** (diff-bar).

## 동작 흐름

파일 선택 → `compute_diff`: 이미지 확장자면 즉시 Binary(사이즈는 `blob_size`/스냅샷/디스크 metadata), 아니면 git diff → "Binary files" 감지 시 Binary, 빈 패치면 스냅샷 diff(양쪽 NUL sniff → Binary 강등), 스냅샷도 없으면 디스크 sniff 후 Binary 또는 기존 snapshots_unavailable. Binary 수신 시 `DiffBody` 가 `BinaryFileView` 로 분기, 이미지는 `diff_binary_preview` 를 한 번 더 호출.

## 함께 잡은 버그

1. **untracked 바이너리 무한 "파일을 읽는 중…"**: snapshots_unavailable 폴백이 `read_project_file`(`read_to_string`, UTF-8 전용)로 통짜 읽기를 시도 → 실패 시 null 로 남아 로딩 문구에 영원히 갇힘. 백엔드 sniff 선차단 + 프론트 `newFileError` 상태로 읽기 실패 안내 추가.
2. **스냅샷 바이너리 깨진 diff**: `from_utf8_lossy` 가 바이너리를 � 나열로 렌더 → Binary 카드로 강등.
3. **truncate 바이트 예산 초과**: `truncate_patch`/`render_unified_diff` 가 `chars().take(max_bytes)` 로 문자 수를 세어 한글 diff 가 예산의 최대 4배(64KB→256KB IPC) → `is_char_boundary` 기준 바이트 절단으로 수정 (한글 회귀 테스트 동반).
4. **프로젝트 전환 상태 누수**: 사이드바 인라인 전환은 DiffScreenV2 를 리마운트하지 않아 이전 프로젝트의 baseline pin·in-diff 검색어·직전 커밋 정보가 남던 것 → projectId 변화 시 리셋.

## 검증

- `pnpm typecheck` / `pnpm test`(932개, 신규: 바이너리 카드·이미지 프리뷰·읽기실패 안내·라인번호 오프셋·parseHunkHeader 5건) / `pnpm lint` / `pnpm build` 모두 exit 0 직접 확인.
- `cargo test` exit 0 (신규: image_mime 매핑·NUL sniff 경계·"Binary files" 감지 오탐·한글 truncation 4건 포함) — bindings.ts 재생성 확인.