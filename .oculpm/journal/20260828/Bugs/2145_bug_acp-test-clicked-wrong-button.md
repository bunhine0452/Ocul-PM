---
schema_version: 1
type: bug
slug: acp-test-clicked-wrong-button
status: done
difficulty: medium
created_at: "2026-08-28T21:45:00+09:00"
session_id: "manual-20260828-214500"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src/__tests__/acp_conversation_seams.test.tsx"
    op: update
  - path: "src/__tests__/acp_parallel_sessions.test.tsx"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related:
  - "20260828/Features_to_add/2130_feature_terminal-command-blocks.md"
tags: [test, flake, acp, race]
---

[x] 부하에서만 깨지던 테스트 둘 — 준비되기 전에 눌렀다

## 발생 원인

### (1) ACP 전송 — 같은 버튼의 다른 상태를 눌렀다

전체 스위트를 최대 병렬로 돌리면 `acp_conversation_seams.test.tsx` 와
`acp_parallel_sessions.test.tsx` 가 **매번 다른 케이스에서** 깨졌다. 파일 단독
실행이나 `--maxWorkers=2` 에서는 통과해 "느려서 나는 타임아웃" 으로 보였고,
실제로 이 파일에는 이미 `configure({ asyncUtilTimeout: 5_000 })` 이 들어 있었다.

한도 문제가 아니었다. 두 파일의 `ask()` 헬퍼가 이렇게 눌렀다:

```ts
fireEvent.click(screen.getByLabelText(/보내기|대기열에 추가/));
```

작성기의 전송 버튼은 **하나**인데 상태에 따라 이름이 바뀐다
(`aria-label={busy ? t("acp.queueSend") : t("acp.send")}`). 즉 이 정규식은
**보내기와 대기열 추가를 둘 다 받아 준다.**

세션이 아직 뜨는 중이면 `busy` 라 버튼이 「대기열에 추가」다. 그 순간 클릭이
들어가면 메시지는 **큐로 들어가고 새 채널이 열리지 않는다.** 그런데 뒤따르는
단언은 `waitFor(() => expect(channels).toHaveLength(1))` — 오지 않을 채널을
5초 기다리다 죽는다. CPU 경합이 심할수록 세션 기동이 늦어져 이 창이 넓어진다.

정리하면 **테스트가 어느 코드 경로를 눌렀는지 스스로 못 박지 않았다.** 느린
머신에서만 다른 경로로 새는 종류의 결함이라, 증상이 타임아웃으로 위장됐다.

### (2) 일지 j/k — 목록이 채워지기 전에 눌렀다

첫 수정을 올리자 CI(ubuntu 러너)에서 **다른 파일**이 같은 방식으로 깨졌다:
`journal_v2.test.tsx > j/k 로 기록된 파일 사이를 오간다` 가
`expected 'ioreum/app/api/g00/' to be 'ioreum/app/api/g01/'` — **j 를 눌렀는데
안 움직였다.**

`EntryDetailView` 의 키 핸들러는 이렇게 시작한다:

```ts
if (e.key === "j" || e.key === "k") {
  if (orderedPaths.length === 0) return;   // ← 조용히 돌아간다
```

파일 **바**는 `files_touched` 로 먼저 그려지지만, j/k 가 도는 `orderedPaths` 는
**diff 가 도착해야** 생긴다. 테스트의 `openDetail()` 은 `.entry-filelist` 가
뜨는 것까지만 기다렸으므로, 그 사이에 눌린 `j` 는 아무 일도 하지 않고 끝났다 —
화면에는 첫 파일(g00)이 그대로 있으니 증상이 "j 가 안 먹는다" 로 보였다.

이번에도 한도가 아니라 **전제**의 문제다: 테스트가 의존하는 상태가 도착했는지
확인하지 않고 조작했다.

## 해결 방법

### (1) ACP 전송

`ask()` 는 **보내기일 때만** 누른다 — 준비될 때까지 기다린다:

```ts
fireEvent.click(await screen.findByLabelText("보내기"));
```

큐 경로를 **의도적으로** 겨냥하는 테스트(「같은 대화에 연달아 치면 예전처럼 줄을
선다」)는 별도 헬퍼 `askQueued()` 로 갈랐다 — 「대기열에 추가」를 기다렸다 누른다.
그 테스트가 원래 하던 `waitFor(getByLabelText("대기열에 추가"))` + `ask()` 두 줄은
헬퍼 안으로 들어가 한 줄이 됐다.

두 헬퍼가 갈리면서 **각 테스트가 어느 상태를 겨냥하는지 이름으로 드러난다.**
한도를 올리는 대신 경로를 못 박은 것이 요점이다 — 한도는 올려도 언젠가 또 넘는다.

### (2) 일지 j/k

**고침** — 오갈 목록이 실제로 채워졌다는 직접 증거(`.efb-count === "1/3"`,
`orderedPaths.length === 3`)를 기다린 뒤 누른다. 같은 위험이 있던 이웃 테스트
(앞뒤 이동 버튼, `1/16`)도 단언에서 `waitFor` 로 바꿨다.

## 검증

- ACP 두 파일 + `acp_session_tabs` 3회 반복 — 11건 전부 통과(3/3).
- `journal_v2.test.tsx` 3회 반복 — 14건 전부 통과(3/3).
- **전체 스위트를 최대 병렬로 2회** — 120파일 1,416건 전부 통과. 고치기 전에는
  같은 조건에서 거의 매번 한 건이 깨졌다(케이스는 실행마다 달랐다).
- 큐 경로 테스트가 여전히 큐를 검증한다: `sent` 가 1 에 머물다 턴이 끝난 뒤
  2 가 되는 단언은 그대로다.
- **느린 러너 흉내** — 코어 12 인 머신에서 `--maxWorkers=24` 로 오버서브스크립션
  해 2회 실행, 120파일 1,416건 전부 통과. CI 러너가 이 머신보다 느린 것이
  두 결함이 거기서만 드러난 이유였으므로, 부하를 만들어 재현 조건을 흉내 냈다.

## 메모

**두 결함의 모양이 같다** — 테스트가 어떤 상태를 전제하면서 그 상태가 도착했는지
확인하지 않았고, 빠른 머신에서는 우연히 맞아떨어졌다. 증상은 둘 다 타임아웃이나
"안 먹는다" 로 위장돼 "느려서 그렇다" 로 오진하기 쉬웠다. 고침도 같다: 한도를
올리는 대신 **전제를 기다린다**.

제품 코드는 건드리지 않았다. 버튼 하나가 상태에 따라 이름을 바꾸는 것 자체는
정상이고(대기 중에 「보내기」라고 적으면 거짓말이다), 문제는 그 둘을 같은 것으로
받아 준 테스트 쪽이었다.
