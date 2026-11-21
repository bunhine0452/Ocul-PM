---
schema_version: 1
type: bug
slug: "stale-verdict-by-content"
status: done
difficulty: medium
created_at: "2026-11-22T03:26:40+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/stale.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
related: []
tags:
  - "오늘"
  - "판정"
  - "git"
  - "mcp-tool"
---
[x] 오늘: 받기만 한 파일은 바뀐 것이 아니다

## 발생 원인

「통과 뒤 바뀜」 은 파일의 수정 시각이 판정 시각보다 늦은가만 봤다. clone · pull · 브랜치 전환 · 워크트리는 내용이 같은 파일의 수정 시각도 지금으로 바꾼다. 그래서 에이전트가 클라우드나 다른 기기 · 워크트리에서 일하고 결과가 git 으로 돌아오면, 판정이 본 그대로인 파일이 오늘 화면과 계획 화면에 호박색 ✓ 로 섰다. 두 기기 라운드(11-13)는 OS 가 다른 경우만 「여기선 아직」 으로 갈랐고, 같은 OS 의 다른 기기 · 새 클론은 그대로였다.

## 해결 방법

수정 시각은 **후보**만 고르게 했다. 후보가 있을 때만 git 에게 묻는다: 판정 줄(그 시각 문자열)을 계획 파일에 들여온 커밋을 찾고(`git log -S`), 그 커밋과 지금 워킹트리의 내용이 다른 파일만 남긴다(`git diff --name-only`). 판정 줄은 확인한 코드와 함께 커밋되므로 그 커밋의 트리가 판정이 본 코드다. 추적하지 않는 새 파일은 diff 가 말하지 않아 그 커밋의 트리에 없으면 바뀐 것으로 남긴다.

빼기만 한다 — 결과는 늘 수정 시각 후보의 부분집합이다. git 이 답하지 못하면(저장소가 아니다 · 판정 줄이 아직 커밋되지 않았다 · 얕은 클론 · 계획 파일 이름이 id 와 다르다) 예전처럼 수정 시각만 본다. 후보가 없는 보통의 날은 git 실행 0 이고, 같은 후보 · 같은 수정 시각의 물음은 프로세스 안 캐시가 답한다. 계획 id 와 시각 문자열은 저장소에 실려 온 글이라 git 인자로 나가기 전에 글자를 좁혔다. 포맷은 바꾸지 않았다 — 판정 줄 · 훅 · 확장은 그대로다.

## 검증

- `cargo test --locked --lib planner::stale`: `test result: ok. 6 passed; 0 failed` (임시 git 저장소로 — 받기만 한 파일 0건 · 정말 고친 파일과 새 파일은 남음 · git 이 모르면 수정 시각 · 후보 없으면 git 0회 · 같은 물음은 한 번)
- `cargo test --locked --lib planner`: `test result: ok. 94 passed; 0 failed`
- `cargo test --locked --test egress_spawn_ledger --test egress_inventory`: `6 passed` · `8 passed`
- 이 저장소에서 잰 git 한 번: log -S 0.087 s · diff 0.088 s · ls-tree 0.084 s (Windows)

## 메모

판정 줄이 코드보다 **먼저** 따로 커밋된 드문 경우에는 그 뒤 커밋의 코드가 「다르다」 로 남는다(예전과 같은 결과 — 더 나빠지지 않는다). 설치본의 오늘 화면에서는 보지 못했다.