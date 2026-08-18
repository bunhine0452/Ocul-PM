---
schema_version: 1
type: bug
slug: "hangul-doubles-on-composing-backspace"
status: done
difficulty: high
created_at: "2026-08-18T20:11:37+09:00"
session_id: "manual-20260818-201137"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_bridge.test.ts"
    op: update
related: []
tags: ["terminal", "ime", "hangul", "claude-code"]
---

[x] 터미널에서 한글이 두 번 찍히던 것 — 조합 중 Backspace 가 브리지 부기를 비웠다

## 발생 원인

터미널에서 Claude Code 를 쓰며 한글을 치면 글자가 두 번 남는다는 제보. 처음엔 받는
쪽(Claude Code TUI)이 브리지의 `DEL + 교체분` 을 못 알아듣는 줄 알았으나, **실제
PTY 에 그 바이트열을 그대로 먹여 보니 정상 처리**됐다 (0.5s / 45ms / 10ms 간격,
그리고 완전히 한 청크로 합쳐진 경우까지 전부 `하나`·`안녕하세요 테스트입니다` 로
올바르게 렌더). 즉 설계와 수신측은 무죄였다.

원인은 브리지 자신이었다. `attachCustomKeyEventHandler` 의 keydown 갈래가

```
else if (event.key === "Backspace" || event.key === "Delete") endSession();
```

로 **조합 여부를 가리지 않고** 세션을 끝내고 있었다. 그런데 한글 입력기에서 조합
중에 누른 Backspace 는 "글자를 지우는" 키가 아니라 음절을 한 단계 분해하는 IME
동작이라 `keyCode 229` 로 온다 — 로그(`oculpm.log.2026-08-14/15`)에 그대로 있다:

```
input   insertReplacementText data="ㅊ" value="ㅊ" echoed="치"   ← 분해 결과. 여기서 DEL+ㅊ 전송 완료
keydown key="Backspace" keyCode=229 imeKey=true                 ← endSession() 이 echoed 를 "" 로
```

`endSession()` 은 `echoed` 와 textarea 를 비운다. 하지만 IME 는 **아직 같은 조합을
붙들고 있다**. 다음 교체분(`차`)이 올라오면 공통 접두사 비교 기준이 `""` 이라
`removals = 0` 이 되어 **DEL 없이 `차` 만** 나간다 → 화면에는 앞 글자가 그대로 남아
`ㅊ차`. 조합 중 Backspace 를 두 번 누르면 `하ㅎ호` 처럼 셋이 남는다.

zsh 에서 잘 드러나지 않은 건 거기선 한글을 거의 안 치기 때문이다 — 실제 트레이스에
남은 한글은 전부 2~3글자 조각이고, **한글 + 스페이스 조합조차 단 한 건도 없다**.
긴 한글 문장을 치며 오타를 지우는 상황(= Claude Code 프롬프트)이 이 경로를 상시로
밟는다.

## 해결 방법

조합 중인 Backspace·Delete 는 세션을 끝내지 않는다 — 분해 결과는 바로 앞 `input`
이 이미 `syncEcho` 로 맞춰 놨으므로 부기를 그대로 이어가면 된다.

```ts
else if ((event.key === "Backspace" || event.key === "Delete") && !imeKey) endSession();
```

조합이 아닌 Backspace(`keyCode 8`)는 종전대로 부기를 리셋한다 — 그건 xterm 이 셸에
DEL 을 보내는 진짜 삭제라 세션을 끊는 게 맞다.

## 검증

- `src/__tests__/ime_bridge.test.ts` 에 회귀 3건 추가. **수정을 되돌리면 2건이 실패**
  하고(`차`→`ㅊ차`, `호`→`하ㅎ호`) 수정 상태에서 통과하는 것을 확인했다.
- 실제 `claude` 를 PTY 로 띄우고 pyte 로 최종 화면을 렌더해 대조:
  수정 전 바이트열 → `❯ 하ㅎ호`, 수정 후 바이트열 → `❯ 호`.
- 게이트 전부 exit 0: typecheck / test(85 파일 981개) / lint / build.

## 메모

브리지가 튜닝된 표본이 짧은 zsh 명령뿐이라 긴 한글 문장 경로가 통째로 미검증
영역이었다. 남은 미검증 인접 경로 두 가지 — (1) blur 가 조합 도중에 들어오는 경우,
(2) 스페이스로 `endSession()` 이 돈 직후 IME 가 조합을 재보고하는 경우 — 는 하네스
상에서는 같은 방식으로 중복이 재현되지만, macOS IME 가 그 시점에 조합을 커밋해
버리는지 실측 트레이스가 없어 이번에는 건드리지 않았다.
