---
schema_version: 1
type: bug
slug: "egress-spawn-ledger"
status: done
difficulty: high
created_at: "2026-10-11T00:00:36+09:00"
session_id: "mcp-20261011-000036"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/egress_spawn_ledger.rs"
    op: create
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: create
  - path: "src-tauri/tests/source_scan/mod.rs"
    op: create
  - path: "src-tauri/tests/llm_prompt_ledger.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "SECURITY.md"
    op: update
  - path: "landing/wiki-src/pages.mjs"
    op: update
  - path: "landing/privacy.html"
    op: update
related:
  - ref: "20261007/Bugs/1027_bug_acp-adapter-locked-install.md"
    kind: "followup"
tags:
  - "security"
  - "egress"
  - "external-review"
  - "mcp-tool"
---
[x] 송출 원장이 하위 프로세스를 못 세던 공백 — 기동 자리 전수 분류(판정 D)

## 발생 원인
송출 원장 A(`egress_inventory.rs`)는 능력 프리미티브(`reqwest::` · `TcpListener` · `fetch(`)로만 송출 자리를 찾았다. 그래서 앱이 하위 프로세스를 띄워 나가는 자리를 보지 못했다 — npm 어댑터 설치, 새 프로젝트 마법사의 `npx create-next-app`, 터미널 셸, 언어 서버. 막혀 있던 것은 세 기동 모양에 글자 그대로 붙은 curl · wget 두 이름뿐이었다.
git 로컬 전용 검사에도 실제 공백이 있었다. 이 검사는 git 을 직접 띄우는 파일만 읽었다. 그런데 출시 코드에서 git 을 띄우는 파일은 `git/safe.rs` 하나이고, 거기서 하위 명령은 변수다. 하위 명령 글자가 적히는 `git/*` · `oculpm/index/*` 는 하나도 읽히지 않았다. 「3개 이상」 낡음 검사는 테스트 픽스처 둘이 채우고 있었다.

## 해결 방법
- 새 원장 `egress_spawn_ledger.rs` 와 데이터 파일 `sites.rs` 를 두었다. 프로세스를 띄우는 자리 전부를 (파일, 감싸는 함수, 띄우는 것) 단위로 원장과 집합 상등 대조한다. 판정은 다섯이다.
  - D1 출시 코드 43곳: 송출 가능 12 / 로컬 26 / 창구 5
  - D2 테스트 범위 27곳 — 테스트 범위인지는 스캐너가 판정한다
  - D3 웹뷰의 opener · shell 플러그인 쓰임
  - D4 clippy `disallowed-methods` 우회 차단
  - D5 모든 항목에 사유
- curl · wget 금지와 git 네트워크 하위 명령 검사를 이 파일로 옮기고 넓혔다. 이제 창구(`git::safe::cmd`)를 부르는 파일과 `git/` 모듈 전부를 본다. `ls-remote` · `submodule` 도 금지 목록에 넣었다.
- `llm_prompt_ledger` 의 렉서를 `tests/source_scan/` 공용 모듈로 뺐다(동작 불변).
- 문서 공백도 메웠다. 템플릿 생성기의 npm 통신이 어디에도 없었다. 개인정보 페이지(ko · en)와 CLAUDE.md 에 「앱이 대신 띄우는 도구의 통신」 한 문단을 두었다. 앱 자신의 송출 「여섯 갈래」는 그대로다. SECURITY.md 의 지키는 자리에 기동 원장을 더했다.
- 레인이 남긴 메모 「부분 클론은 빠진 객체를 지연으로 받을 수 있다」는 재현해 보니 코드 실행 문이었다. 별도 일지에 적었다.
- 병렬 레인(Opus 5.5)이 구현했다. PR #83.

## 검증
- 변이 시험: 가짜 기동 자리(std_cmd · CommandBuilder) → D1 실패. allow 속성 → D4 실패. 테스트 범위 기동 → D2 만 실패. opener import → D3 실패. 원장 항목 삭제 · 가짜 추가 · Relay 오표기 → 각각 실패.
- 합류 뒤 내가 새로 단 git 회귀 시험(`clone` 글자 · 미등록 기동)을 이 원장이 실제로 잡았다. 게이트가 작동한다.
- cargo test --no-fail-fast 실패 0, PR #83 CI success.