---
schema_version: 1
type: chore
slug: "two-phase-headless-agent-spike"
status: done
difficulty: medium
created_at: "2026-10-05T05:45:34+09:00"
session_id: "20261005-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20261005_native-agent-drivers/00-master-plan.md"
    op: update
  - path: "docs/20261005_native-agent-drivers/spike/two_phase_headless_spike.py"
    op: create
related:
  - ref: "20261005/Chores/0221_chore_rc-remote-roundtrip-verified.md"
    kind: "followup"
tags:
  - "codex"
  - "claude-code"
  - "research"
  - "automation"
  - "mcp-tool"
---
[x] 기다리지 않는 dots 스파이크 — claude -p dontAsk / codex exec 샌드박스로 막히면 멈추고, 별도 프로세스 재개로 완료

## 배경

사용자: ACP 위에서는 dots 를 완성도 있게 못 만들 것 같다. 진짜 약점은 ACP 가 아니라 "에이전트 프로세스를 띄워 두고 승인 요청에 사람이 답할 때까지 붙잡는 구조"(앱 재시작·Mac 잠자기·몇 시간 대기에 깨짐 — 같은 날 /rc 스파이크 프로세스도 10분 타이머가 안 끝났다). 대안: 막히면 멈추고, 승인되면 **별도 프로세스로 재개**. 공식 문서화된 헤드리스 모드만으로 되는지 시험.

## 결과 — 둘 다 된다

- **Claude** (`claude -p --permission-mode dontAsk --allowedTools=Read,Edit,Write`): 커밋 거부 → `NEEDS:` 종료, `result.permission_denials` 에 막힌 Bash 명령이 구조화돼 옴. 2단계 `--resume <sid> --allowedTools=…,Bash(git commit:*)` → 같은 세션에서 편집+커밋, worktree 깨끗.
- **Codex** (`codex exec --json -s workspace-write` + /tmp 쓰기 제외): 편집은 됨, 커밋은 샌드박스(`.git/worktrees/<wt>/index.lock: Operation not permitted`) → `NEEDS:` 종료. 2단계 `codex exec … -c sandbox_workspace_write.writable_roots=["<repo>/.git"] resume <thread_id>` → 커밋 완료. **`.git` 하나만 더한 최소 승격**으로 충분.
- 승인 대기 상태가 프로세스 밖(worktree · 세션 id · 막힌 것 목록)에만 있다 → D6(실시간 대기 영속)보다 단순.

## 밟은 함정 (구현 때 재발)

- `--allowedTools` 가변 인자가 프롬프트를 삼킴 → `=` 형태.
- `/tmp` 아래 저장소는 Codex `workspace-write` 가 기본 허용 → 두 번째 시도는 막히지 않고 바로 커밋(무효). `exclude_slash_tmp`·`exclude_tmpdir_env_var` 로 실환경 흉내.
- 지시문 끝 마침표를 Codex 가 `git commit … .` 인자로 읽음(첫 시도 무효, 실패 원인이 샌드박스가 아니라 git 인자 오류).
- stdin 열려 있으면 경고/대기 → `/dev/null`.
- 헤드리스 Claude `system/init.tools` 에 ocul-pm MCP 도구 없음 — 지연 로딩인지 미로딩인지 미확인.

## 문서 반영

설계 문서 §2.4 신설(명령·결과 표·함정·결론), D6 아래에 "더 단순한 대안 실측 — P4 교체·앞당김은 사용자 결정 대기" 주석. 재현 스크립트 `spike/two_phase_headless_spike.py`. 플랜은 아직 안 바꿨다.

## 검증

- Claude run2: C1 permission_denials 1건 → C2 log `93405db bg: hello`, dirty 없음.
- Codex run5: X1 exit_code 128 Operation not permitted, dirty `M notes.txt` → X2 log `9c293a7 bg: hello`, dirty 없음. (run3 은 지시문 마침표, run4 는 /tmp 허용 때문에 무효 — 기록만.)