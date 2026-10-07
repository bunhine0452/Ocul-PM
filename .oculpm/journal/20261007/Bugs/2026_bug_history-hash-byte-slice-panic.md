---
schema_version: 1
type: bug
slug: "history-hash-byte-slice-panic"
status: done
difficulty: low
created_at: "2026-10-07T20:26:54+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/history.rs"
    op: update
  - path: "src-tauri/src/oculpm/history_tests.rs"
    op: update
related: []
tags:
  - "security"
  - "external-review"
  - "utf8"
  - "mcp-tool"
---
[x] 로컬 히스토리가 meta.json 해시를 바이트로 잘라 한글에서 패닉하던 것

## 발생 원인

외부 보안 피드백 2차 #3. `snap_name` 이 `&entry.hash[..len.min(8)]` 로 잘랐다. 해시는 우리가 쓴 blake3 hex 라고 가정했지만 `meta.json` 은 디스크의 파일이고 저장소에 실려 올 수 있다(`.oculpm/index/` 는 gitignore 지만 강제로 커밋할 수 있다). 해시에 「가나다」 가 있으면 바이트 8 이 「다」 의 한가운데라 패닉했다 — 읽기·캡처·예산 정리 셋 다 이 이름을 만든다. 리뷰가 말하지 않은 것: 해시가 스냅샷 파일 이름의 일부라 `../../x` 같은 값은 스냅샷을 엉뚱한 자리에서 읽고 지우게도 했다.

## 해결 방법

- `parse_meta` — 읽는 순간 blake3 hex 64자가 아닌 판을 버린다. `read_meta`·`walk_history`(예산 정리·이름 따라가기) 둘 다 이걸 지난다.
- `snap_name` 은 문자 단위로 자른다 (방어 겹).
- 같은 파일의 캡처가 링크와 링크 폴더 아래 경로를 남기지 않게 했다 (`path_guard` — 일반 파일 링크 일지와 같은 부류).
- 같은 꼴의 다른 바이트 슬라이스 13곳을 훑었다 — 전부 우리가 만든 hex 이거나 ASCII 로 정규화된 slug·git 상태 글자라 남은 위험은 없다.

## 검증

- 새 테스트: 한글 해시·`../../x` 해시·정상 해시가 섞인 meta 를 심어 목록에 정상 판만 남고 `read_snapshot`·`enforce_budget` 이 패닉하지 않음을 본다. 링크 캡처 거부 1.
- `cargo test` 전체 통과. PR #70.