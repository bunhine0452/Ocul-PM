---
schema_version: 1
type: bug
slug: "pre-release-audit-fixes"
status: done
difficulty: medium
created_at: "2026-09-04T09:26:54+09:00"
session_id: "20260904-006"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/sessions/useSessionBoard.ts"
    op: update
  - path: "src/features/sessions/sessionAttention.ts"
    op: update
  - path: "scripts/check-file-sizes.mjs"
    op: update
  - path: "src/__tests__/file_size_ratchet.test.ts"
    op: update
  - path: ".gitignore"
    op: update
related: []
tags:
  - "a2a"
  - "leak"
  - "lint"
  - "pre-release"
  - "mcp-tool"
---
[x] 릴리스 직전 감사에서 잡은 넷 — 새는 구독, 안 지워지는 경고, 눈 먼 게이트

## 발생 원인

v2.40.0 배포 전 점검에서 넷이 나왔다. 게이트는 전부 초록이었으므로 전부 게이트가 못 보는 것들이다.

**① 세션 화면의 이벤트 구독이 언마운트 뒤에도 산다.** `useSessionBoard` 가 `listen()` 의 해제 함수를 `.then` 안에서 변수에 담는데 `alive` 검사가 없었다. 화면을 스쳐 지나가거나 dev StrictMode 의 mount→cleanup→mount 를 타면, cleanup 이 `offChanged` 가 아직 `undefined` 인 채로 돌고 그 뒤 프라미스가 resolve 하며 리스너가 **영구 등록**된다. 이후 A2A 원장이 바뀔 때마다 죽은 훅의 `reload()` 가 돌아 `a2a_overview` IPC 를 한 번 더 쏘고 언마운트된 컴포넌트에 `setData` 한다 — 드나든 횟수만큼 겹친다.

같은 라운드의 `sessionAttention.ts` 는 **정확히 이 경우를 막아 뒀다** (`if (alive) off = stop; else stop();`). 한쪽만 빠진 것이다.

**② 「남의 구역을 건드렸어요」 경고가 안 지워진다.** 침범은 이벤트로만 오고 원장에는 남지 않는데(`Trespass` 주석이 그렇게 적어 뒀다), 해소를 알려 주는 신호도 없다. 그래서 임대가 만료되거나 주인이 놓아 충돌이 끝나도 그 줄이 「급한 것」 자리에 그대로 남는다. 이 화면은 이번에 **목적지**가 되면서 마운트가 몇 시간씩 유지되므로 더 오래 남는다.

**③ 파일 크기 래칫이 미추적 새 파일을 못 본다.** `scripts/check-file-sizes.mjs` 가 `git diff --name-status -z <base>` 로 후보를 만드는데, `git diff` 는 **추적 파일만** 본다. 실측:

```
미추적 901줄 파일       → ✓ file size: clean        (안 보임)
git add -N 뒤 같은 파일 → ✗ 901줄 (허용 800, 신규)
```

800줄을 처음부터 넘겨 태어나는 파일이 바로 이 사각지대에 앉는다. 어제 `tools.rs`(3,344줄)를 가르며 나온 1,697줄 테스트 파일이 로컬에서 clean 이었다가 커밋 직후 CI 를 붉힌 것이 이것이다 — 게이트가 **커밋 전에** 말해 주지 못하면 늦게 오는 잔소리가 된다.

**④ `.agent/rules/ocul-pm.md` 가 추적도 무시도 아니었다.** ocul-pm 이 `.oculpm/agents/_template.md` 에서 자동 생성한 Antigravity 규칙 파일인데(첫 줄에 "직접 편집하지 마세요"가 박혀 있다), 결정이 안 돼 매 세션 `git status` 에 `??` 로 남아 있었다.

## 해결 방법

① `alive` 플래그 + `safeUnlisten` 으로 바꿨다. 붙기 전에 떠났으면 그 자리에서 뗀다. 저장소 관용구는 `JournalMissingCard.tsx` 가 이미 쓰던 것이다. `sessionAttention.ts` 도 raw `stop()` 대신 `safeUnlisten` 을 쓰게 했다 — `lib/unlisten.ts` 주석이 적어 둔 대로 해제는 실제로 async 라 리로드 시점에 reject 하고, 그게 콘솔 브리지를 타고 `oculpm.log` 를 오염시킨다.

② `Trespass` 에 도착 시각(`at`)을 싣고 **10분**이 지난 것은 화면에서 뺀다. 해소 신호가 없으므로 해소를 추측하는 대신 시간을 재는 쪽을 택했다 — 침범은 상태가 아니라 사건이다. 이미 도는 분 시계(`useMinuteTick`)에 얹어 지우는 타이머를 따로 두지 않았다.

③ 후보 집합에 `git ls-files --others --exclude-standard` 를 더했다. 미추적 파일은 기준선에 없으므로 전부 신규(`A`)이고 800줄 상한을 그대로 맞는다. 파싱은 `parseUntracked` 로 떼어 테스트했다.

④ `.claude/` 와 같은 이유로 gitignore 했다. 규칙의 SSOT 는 추적되는 `AGENTS.md` 이고 이건 그 거울이라, 커밋하면 템플릿 한 번 고칠 때마다 같은 문장이 두 곳에서 흔들린다.

## 검증

게이트 전부 exit 0 을 **체인으로** 확인했다: `pnpm typecheck` 무오류, `pnpm test` 168파일 **2197** 통과, `pnpm lint`(체인 전체) exit 0, `pnpm build` 성공, `cargo test` 20개 스위트 실패 0, `cargo clippy --all-targets -- -D warnings` 무경고, `cargo fmt --check` 클린.

③ 은 탐침으로 앞뒤를 재 확인했다 — 고치기 전에는 미추적 901줄이 clean 이었고, 고친 뒤에는 잡힌다. 회귀 테스트 3건(`parseUntracked`)을 `file_size_ratchet.test.ts` 에 넣었다.