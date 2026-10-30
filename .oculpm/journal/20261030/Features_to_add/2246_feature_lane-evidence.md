---
schema_version: 1
type: feature
slug: "lane-evidence"
status: done
difficulty: medium
created_at: "2026-10-30T22:46:41+09:00"
session_id: "20261030-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/race.rs"
    op: update
  - path: "src-tauri/src/git/race_tests.rs"
    op: update
  - path: "src/features/terminal/RacePanel.tsx"
    op: update
  - path: "src/features/terminal/race.css"
    op: update
  - path: "src/__tests__/terminal_race.test.tsx"
    op: update
related: []
tags:
  - "여럿에서"
  - "orca-bench"
  - "evidence"
  - "mcp-tool"
---
[x] 여럿에서: 레인을 일지 증거로 고르게 한다

## 추가 기능

사용자 요청(10-30): 「orca 보다 더 좋게 만들어 줘」. 넷을 제안했고, 사용자는 「레인을 증거로 고르기」와 「보낸 메모가 고쳐졌는지 자동 표시」를 골랐다(계획 `beyond-orca-20261030`). 이 일지는 앞의 것이다.

Orca 는 레인(worktree)의 diff 를 눈으로 비교한다. Ocul 은 레인 안의 Claude 가 쓴 일지와 그 검증 증거로 비교한다.

## 동작 흐름

- **기록 폴더 심기**(`seed_records`):
  - 원래 프로젝트에 `.oculpm` 이 있는데 레인 checkout 에는 없으면(git 에 안 올린 저장소), 레인에 `.oculpm` 을 만들고 `config.toml` 을 복사한다.
  - 없으면 MCP 도구가 모두 거절해서(`call_tool` 의 `.oculpm` 검사) 레인의 Claude 가 일지를 못 쓴다.
- **기록 폴더 빼기**: 그런 저장소(`git ls-files -- .oculpm` 이 빔)에서는 레인의 diff · 크기 · 가져오기에서 `:(exclude).oculpm` 으로 뺀다. 가져오면 원래 쪽의 `config.toml` 과 부딪친다.
- **레인 증거**(`read_evidence`):
  - 레인의 `.git` 파일 시각(worktree 를 만들 때 쓴다) 뒤에 쓰인 일지를 센다.
  - 가장 최근 것에서 제목(`markdown::parse_body`), 증거 등급(`evidence::evidence_level`), 검증 칸의 끝 줄(`proof_line`)을 뽑아 `RaceLane` 에 싣는다.
- **띠:**
  - 레인마다 「명령 있음 · 명령 없음 · 검증 없음 · 일지 없음」 칩과 끝 줄(가리키면 제목)을 보인다.
  - `recommendLane` 은 명령 증거가 있는 레인 가운데 바뀐 줄이 가장 적은 레인을 고르고 「추천」을 붙인다. 칩은 outline 이다(초록은 통과에만, 화면 검사 #green-meaning).
  - 줄마다 같은 칸(grid)이라 세로로 맞는다. 처음에는 단추 칸이 남는 폭을 먹어 늘어나서 `max-content` + `justify-content: start` 로 고쳤다.
  - 레인 diff 머리에 일지 제목과 증거를 보인다.

## 검증

- `cargo test --lib git::race` → 4 passed. 새로 넣은 `a_lane_gets_records_and_reports_its_evidence` 가 본 것:
  - 심기, 크기에서 기록 폴더가 빠짐(files 1)
  - 제목 「캐시: 만료 고침」 · COMMAND · 끝 줄 「cargo test → 12 passed」
  - 일지 없는 레인 (0, 0), 가져와도 config 충돌 없음 · 레인 일지가 섞이지 않음
- `terminal_race.test.tsx` → 4 passed(+1): 추천은 명령 증거 레인 중 최소 변경이고, 칩 넷이 맞다.
- 하네스(어두운 ko · 밝은 en): 정렬된 띠 · 추천 · 끝 줄을 스크린숏으로 확인했다.
- 처음 게이트에서 둘이 걸려 고쳤다.
  - clippy `filter().next_back()` → `rfind`
  - `i18n_glossary` 「검증 칸 · 증거 → 검증」
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 972 passed · `pnpm lint` 0 · `pnpm build` 0
  - `cargo fmt --check && clippy -D warnings && cargo test --locked --no-fail-fast` → rust passed 1166 failed 0