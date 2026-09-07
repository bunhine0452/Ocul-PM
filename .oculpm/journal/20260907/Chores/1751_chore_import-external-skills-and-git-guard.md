---
schema_version: 1
type: chore
slug: "import-external-skills-and-git-guard"
status: done
difficulty: low
created_at: "2026-09-07T17:51:40+09:00"
session_id: "20260907-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "6cb813ef-9c7c-4e4f-9662-101b24e03c73"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".claude/skills/grilling/SKILL.md"
    op: create
  - path: ".claude/skills/diagnosing-bugs/SKILL.md"
    op: create
  - path: ".claude/skills/writing-for-agents/SKILL.md"
    op: create
  - path: ".claude/hooks/block-dangerous-git.sh"
    op: create
  - path: ".claude/settings.json"
    op: update
related: []
tags:
  - "skills"
  - "hooks"
  - "git"
  - "agent-discipline"
  - "mcp-tool"
---
[x] 외부 스킬 3종 이식 + git 가드레일 훅 — 남의 규율을 이 저장소 도구로 번역

## 동기

`mattpocock/skills` (MIT) 26개를 훑고, 이 저장소에 실제로 값하는 것만 골라 이식했다. 판정 기준은 **중복 아님 + 스택 일치 + 우리 규율과 충돌 없음**. 트래커 묶음(triage/to-tickets/wayfinder 등 6개)은 GitHub Issues 전제라 그대로는 못 쓰고 — 그 역할은 `.oculpm/planner` 가 이미 한다 — `tdd`·`code-review`·`retro`·`handoff` 는 기존 스킬/화면과 중복이며, `research`·`code-review` 는 서브에이전트를 기본으로 띄워 전역 지침("명시 요청 시에만")과 충돌한다.

## 추가 기능

`.claude/skills/` 에 3종. 전부 한국어 각색이고 원안 출처를 파일 끝 주석에 남겼다.

- **grilling** — 설계 결정을 트리로 놓고 *프론티어*(선행 결정이 굳어 지금 물을 수 있는 질문)만 한 라운드에 묶어 묻는다. 질문마다 추천 답. 사실 조사는 내 몫, 결정은 사용자 몫. 각색점: 서브에이전트 위임을 "사용자 요청 시에만" 으로 바꾸고, 굳은 결과를 `plan_create`·`.oculpm/discussion/` 으로 내려앉히게 했다.
- **diagnosing-bugs** — 핵심은 Phase 1 게이트: *빨개질 수 있는 명령 하나를 이미 돌려보기 전에는 가설 금지*. 각색점: 루프 만드는 법 9가지를 이 저장소 도구로 다시 썼다 (`pnpm vitest run -t`, `cargo test --test`, `oculpm.log` FLOW/TRACE 재구성, PTY 바이트 재생, 측정 하니스 보존, `git bisect run`). 완료 체크리스트에 4게이트 + `cargo test`.
- **writing-for-agents** — 컨텍스트 포인터(스킬 description 과 AGENTS.md 의 문서 참조 줄은 같은 물건이고, 대상이 아니라 *문구*가 도달률을 정한다), model-invoked vs user-invoked 의 비용 계산, 라우터 스킬. 각색점: 이 저장소 고유 사실 3개를 넣었다 — `context_discover` 는 이름·description·`keywords` 만 색인하므로 본문 트리거는 도달 경로가 아니라는 것, `AGENTS.md` 한 줄이 모든 사용자 모든 턴에 실린다는 것, 항상-로드 규칙 크기가 예산 바에 그대로 나타난다는 것.

`.claude/hooks/block-dangerous-git.sh` + `.claude/settings.json` 의 PreToolUse(Bash) 등록.

원안(`git-guardrails-claude-code`)을 그대로 쓰지 않은 이유 셋을 스크립트 헤더에 남겼다. ① 원안은 `git push` 를 통째로 막는데 태그 푸시가 곧 릴리스인 이 저장소에서는 릴리스가 죽는다 → `--force` 만 막고 `--force-with-lease` 는 통과. ② 원안은 커맨드 문자열 전체에 grep 을 걸어 커밋 메시지에 "reset --hard" 라고 적기만 해도 차단된다 → 따옴표 안을 먼저 지우고 검사. ③ `git branch -D` 는 막지 않는다 — rebase 머지 뒤 브랜치 정리의 정상 경로다.

막는 것: `add -A|--all|-u|.` · `commit -a|-am` · `reset --hard` · `checkout/restore .` · `clean -f*` · `push --force|-f`. 전부 병렬 세션이 워킹트리·인덱스를 공유해서 생긴 실제 사고(2d95df8)의 형태다.

구현 중 자체 결함 1건: 규칙을 `"패턴|이유"` 배열에 담고 `${rule%%|*}` 로 쪼갰는데, 패턴 안의 정규식 교대 `|` 에서 먼저 잘려 패턴이 반토막 났다. 함수 인자 2개로 넘기는 형태로 고쳤다.

## 검증

`bash -n` 통과. 차단 케이스 13개(`git add -A`, `add .`, `add -u`, `commit -am "fix"`, `reset --hard HEAD~1`, `checkout .`, `checkout -- .`, `restore .`, `clean -fd`, `push --force`, `push -f` 등)와 통과해야 하는 케이스 10개(`add <경로>`, `commit -m 'fix: reset --hard 를 막는다'`, `commit --amend`, `push origin main`, `push origin v2.44.1`, `push --force-with-lease`, `branch -D`, `restore <파일>`, `clean -n`, `reset HEAD~1`) 전부 기대대로 — 23/23. 세션 재시작 후 훅이 실제로 붙는지는 다음 세션에서 확인.

`.claude/` 는 gitignore 라 커밋 대상이 아니다 — 이 기록이 유일한 흔적이다.