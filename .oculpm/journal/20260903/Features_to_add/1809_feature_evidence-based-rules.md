---
schema_version: 1
type: feature
slug: "evidence-based-rules"
status: done
difficulty: high
created_at: "2026-09-03T18:09:24+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-file-sizes.mjs"
    op: create
  - path: "src/__tests__/file_size_ratchet.test.ts"
    op: create
  - path: "package.json"
    op: update
  - path: "src-tauri/src/oculpm/defect_clusters.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/a2a_tools.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/mod.rs"
    op: update
  - path: "src-tauri/src/commands/rules.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/features/skills/contextModel.ts"
    op: update
  - path: "src/features/skills/useContextAudits.ts"
    op: create
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/skills/ContextBudgetBar.tsx"
    op: update
  - path: "src/__tests__/agent_context_model.test.ts"
    op: update
  - path: "src/__tests__/plugin_docs_sync.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md"
    kind: "followup"
tags:
  - "rules"
  - "lint"
  - "ratchet"
  - "mining"
  - "buzz-borrows"
  - "mcp-tool"
---
[x] 규칙에 근거를 붙이고, 파일 크기에 래칫을 건다

## 추가 기능

`block/buzz` 에서 둘을 가져왔다 (논의 `.oculpm/discussion/buzz-borrows/discussion.md` F6·F7).

**① 파일 크기 래칫** (`scripts/check-file-sizes.mjs`) — CLAUDE.md 의 "800줄이 한계"는 여태 강제되지 않았고, 도입 시점 실측으로 **초과 파일이 50개**였다. 전부 지금 고치라고 하면 게이트가 통째로 무시되므로 래칫으로 건다:

```js
allowedLineCount(base, max) = base == null || base <= max ? max : base
```

이미 넘은 파일은 **현재 크기까지만** 허용한다. 줄이는 것은 되고 늘리는 것은 안 된다. 기준선은 `git merge-base origin/main HEAD` 3점 diff (2점이면 리베이스 뒤 main 이 건드린 전부가 걸린다), CI 는 `HEAD^1`, `OCULPM_FILESIZE_BASE` 로 덮어쓴다. **origin/main 을 못 찾으면 조용히 통과하지 않고 실패한다.**

**② 일지에서 캔 결함 클러스터** (`src-tauri/src/oculpm/defect_clusters.rs`) — buzz 는 PR 리뷰 스레드를 캐서 규칙마다 근거와 **수정률**을 붙였다. 우리에게는 리뷰 스레드가 없고 일지가 있어서 지표가 다르다: **재발 간격**(같은 클러스터가 며칠 만에 다시 났나). buzz 의 수정률은 "지적 → 수정" 짝이 있어야 나오는데 우리 표본에는 그 짝이 없다 — 그래서 흉내 내지 않고 다른 이름으로 부른다.

클러스터는 상상해서 만들지 않았다. 이 저장소 버그 일지 126건을 실제로 훑어 반복되는 낱말을 모았다: 고아 프로세스 · 조용한 실패 · 경계를 넘어 새는 상태 · 폭주하는 호출 · 경로 경계 · 버전 불일치 · 화면이 거짓을 말함.

**③ 규칙 ↔ 근거 연결** — 규칙 본문이 클러스터의 언어를 쓰면 후보로 잇고(`rules_evidence`), 목록 행에 「근거 일지 N건」 배지를, 예산 바에 「근거가 붙은 규칙 N개 · 일지 M건」을 단다. 예산 화면은 여태 규칙의 **비용**(바이트)만 알았다. 이제 반대편 숫자가 있다.

## 동작 흐름

**1차 채굴이 오탐 범벅이었다.** 본문 전체를 훑었더니 27건짜리 클러스터가 나왔는데, 뜯어 보니 "해결 방법" 절의 *격리했다*가 격리 결함으로, 메모의 *노출*이 권한 결함으로 잡히고 있었다. 고친 이야기를 결함으로 세고 있었던 것이다.

두 가지를 조였다 — 표지를 흔한 낱말에서 **결함을 이름 짓는 구절**로(`회수` → `회수하지 않`, `옛 ` 삭제), 그리고 매칭 범위를 **제목 + 「발생 원인」 절**로. 결과: orphan-process 27→6, silent-failure 34→19, runaway-calls 16→4, false-display 19→5. `path-escape` 는 표본이 3 밑으로 떨어져 **아예 사라졌다** — 침묵 규율이 실제로 작동한 자리다.

**래칫이 내 코드를 먼저 잡았다.** 켜자마자 두 파일이 걸렸다.

- `mcp/tools.rs` 3,675줄 (이번 라운드 프레이밍 작업으로 +144) → a2a 도구를 `mcp/a2a_tools.rs` 로 갈라 3,240줄. 동작 변경 없음, 디스패처가 그대로 부른다.
- `SkillsScreenV2.tsx` 801→819 (근거 배선으로 +18) → 보조 신호 넷(범위 감사·부정·근거·휴면)을 `useContextAudits` 훅으로 뽑아 740줄. 프로젝트가 바뀔 때 넷을 함께 비우는 규율도 한자리에 모였다.

게이트가 "쪼갤 자리를 찾으라"고 했고 두 번 다 자리가 실제로 있었다.

**`lib.rs` 는 대상에서 뺐다.** 커맨드 하나가 늘 때마다 `use` 한 줄과 `collect_commands!` 한 줄이 **반드시** 는다 — 길이가 설계가 아니라 기능 수의 함수인 파일이다. 여기에 래칫을 걸면 "커맨드를 더 못 붙인다"가 되고, 그건 지켜지지 않고 우회될 규칙이다. `bindings.ts`(생성물)·`i18n/*.ts`(사전)도 같은 이유로 뺐다.

## 검증

- 순수 함수: 래칫 17 (vitest — 경계값·이름 바뀐 파일 R 상태·기준선 해석·"못 잡으면 던진다") + 채굴 5 (Rust — 표본 부족 침묵·근거 발췌·재발 간격·규칙 연결) + `indexEvidence` 3 (vitest — 근거 없는 규칙은 색인에 **없다**, 여러 클러스터의 일지 중복 제거).
- 실측 회귀: `mines_this_repository` 를 `#[ignore]` 로 남겼다 — 저장소 내용에 의존해 단언은 못 하지만 표지를 다듬을 때 이 자가 필요하다.
- 게이트 전부 직접 확인 — `cargo fmt --check` · `clippy --all-targets -D warnings` · `cargo test`(1317, 0 실패) · `pnpm typecheck` · `pnpm test`(162파일 2108) · `pnpm lint`(**새 lint:filesize 포함**) · `pnpm build` 모두 exit 0.

## 메모

플랜의 `{#link-proposal}`(「항상 로드인데 근거 없음」을 정리 제안에)은 **떨어뜨렸다.** 우리 연결은 표지 기반 휴리스틱이라 대부분의 규칙에 근거가 안 붙는데, 그걸 "쓸모없다"로 제안하면 화면이 데이터가 지지하지 않는 판정을 내린다. 침묵은 무죄의 증거가 아니고 유죄의 증거도 아니다 — 그래서 근거는 **붙은 것만** 말한다.

`plugin_docs_sync.test.ts` 가 도구 정의를 `tools.rs` 한 파일에서만 찾고 있어 분할과 함께 깨졌다. 두 파일을 함께 읽도록 고쳤다 — 한쪽만 읽으면 그 게이트가 조용히 반쪽이 된다.