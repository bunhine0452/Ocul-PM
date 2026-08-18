---
schema_version: 1
type: bug
slug: "code-screen-save-hardening"
status: done
difficulty: high
created_at: "2026-08-19T07:25:00+09:00"
session_id: "manual-20260819-072500"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/codeBuffers.ts"
    op: update
  - path: "src/__tests__/code_buffers.test.ts"
    op: update
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: [".oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md"]
tags: ["code-editor", "crlf", "symlink", "security", "claude-code"]
---

[x] 코드 화면 저장 경로 5중 보강 — CRLF 파괴·심링크 이탈·이중 ⌘S·조용한 유실 2종

## 발생 원인

v2.13.0 코드 화면을 에이전트 2대(코드 화면 전담 + Rust 백엔드 전담)가 교차
리뷰해 확인한 결함들.

1. **CRLF 파괴 (HIGH)** — CM6 은 어떤 줄바꿈이든 내부 LF 로 합치고
   `doc.toString()` 은 LF 로만 잇는다. CRLF 파일에서 한 글자만 고쳐 저장해도
   파일 전체가 LF 로 바뀌었다 (git 에 전체 diff·해시 검사는 통과라 무증상).
2. **심링크 이탈 (CRITICAL)** — `secure_join` 은 어휘적 `..` 검사뿐이라,
   프로젝트 안 `leak → ~/.ssh/id_rsa` 심링크로 `code_read` 가 루트 밖 파일을
   읽을 수 있었다 (rel_path 는 트리에 안 나와도 넣을 수 있는 임의 IPC 인자).
   저장은 rename 이 심링크 자체를 평문 파일로 갈아치워 링크를 조용히 부쉈다.
3. **이중 ⌘S → 가짜 충돌 배너 (MEDIUM)** — CM 키맵의 Mod-s 가 stopPropagation
   없이 window 리스너까지 버블되고, `saving` state 는 같은 틱의 두 번째 호출에
   낡은 값이라 같은 base_hash 로 codeWrite 가 2번 나가 두 번째가 Conflict.
   백엔드도 저장 간 직렬화가 없어 동시 저장이 둘 다 Saved 를 받을 수 있었다.
4. **dirty 버퍼 조용한 유실 (MEDIUM)** — LRU 상한(20) 초과로 미저장 버퍼가
   밀려나도 무통보, 트리의 미저장 배지도 낡은 채 남았다.
5. **열린 파일 외부 삭제 무반응 (MEDIUM)** — watcher 의 codeRead 실패를 조용히
   삼켜, 사용자는 저장 실패에서야 알게 됐다.

## 해결 방법

- CRLF: 로드 시 `detectEol`(다수결)로 기억 + 버퍼는 `normalizeEol` 로 LF 정규화,
  저장 직전 `restoreEol` 로 복원 (`codeBuffers.ts` 순수 함수 3종, watcher 리로드
  경로 포함).
- 심링크: `canonical_within_root` — root·대상 모두 canonicalize 후 포함 검사.
  루트 안 심링크는 대상 경로로 해석해 저장하므로 링크도 안 깨진다. code_read /
  code_write 양쪽 적용.
- 이중 ⌘S: CM 바인딩 `stopPropagation: true` + window 리스너 `defaultPrevented`
  가드 + `savingRef` 재진입 가드 3중. 백엔드는 `WRITE_LOCK` 전역 뮤텍스로
  read-check-write 직렬화.
- 유실 알림: `putBuffer` 가 dirty 축출 시 그 키를 반환 → 토스트 경고
  (`code.bufferEvicted`). watcher 읽기 실패 시 경로당 1회 토스트
  (`code.fileGone`). `set_permissions` 실패도 tracing::warn 으로 남김.

## 검증

Rust 단위 17건(신규 3: 심링크 이탈 거부/루트 안 심링크 해석/일반 파일 통과),
vitest 19건(신규: CRLF 왕복 화면 테스트 — 에디터엔 LF·저장은 CRLF 복원, 같은 틱
이중 저장이 codeWrite 1회, EOL 헬퍼·dirty 축출 반환). typecheck/test/lint/build
+ cargo test 5대 게이트 전부 exit 0.

## 메모

에이전트 리뷰의 잔여 backlog: `secure_join` 자체의 심링크 방어(다른 호출처 전수
영향이라 이번엔 code.rs 국소 적용), Unix 백슬래시 파일명 트리 왕복(LOW), 외부
삭제된 파일의 저장 복구 경로(현재는 알림만, 재생성 저장은 미지원).
