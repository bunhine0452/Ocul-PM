/**
 * 에이전트 TUI 가 지금 이 화면에 있는가 (11-15 합류 G-03) — 키 층(`termKeys`)이 Shift+Enter 를 ESC CR(Claude ·
 * Codex 의 줄바꿈)로 바꿀지 묻는다. 대체 화면만 보던 때는 vim · nano · less 에도 ESC CR 이 가서, vim 입력 모드의
 * Shift+Enter 가 ESC 로 노멀 모드에 빠지고 CR 로 한 줄 내려갔다.
 *
 * 「지금」 의 뜻: 상태 신호(OSC 7501 — 탐침 `?` 든 보고든)가 **보통 화면으로 돌아온 뒤에** 왔다.
 *  - 세션의 상태 기록(`TermInfo.status`)은 쓰지 않는다. 기록은 프로그램이 `state=clear` 를 보내거나 세션이 끝날 때까지
 *    남아서(`program_status.rs`) claude 가 지우지 않고 죽으면 같은 셸에서 연 vim 도 에이전트로 보였다. 백엔드는 같은
 *    상태를 두 번 보내지 않으니 같은 셸의 다음 claude 를 상태 사건으로 다시 알 수도 없다.
 *  - 그래서 xterm 이 출력을 읽는 자리에서 본다 — 출력 안의 OSC 7501 과 화면 전환(대체 ↔ 보통)이 같은 차례로 지나가
 *    신호와 화면이 어긋나지 않는다. 백엔드는 이 바이트를 걸러 내지 않고 xterm 은 7501 을 그리지 않는다.
 *  - 보통 화면으로 돌아오면 잊는다 — 전체 화면 프로그램이 끝났거나 화면을 다른 프로그램에 넘겼다. claude 는 시작할
 *    때 탐침을, 입력을 기다릴 때 idle 을 보내니 다음 claude 는 스스로 다시 알린다. `state=clear`(손을 뗐다)도 잊는다.
 *
 * 한계: claude 가 바깥 편집기(Ctrl+G)를 띄웠다 돌아오면 다음 상태 신호(보통 다음 턴)까지 Shift+Enter 가 그냥 Enter 다.
 */
import type { Terminal } from "@xterm/xterm";

/** 시험의 가짜 터미널에는 파서 · 버퍼 사건이 없을 수 있다 — 없으면 늘 「아니다」. */
type Watchable = { parser?: Partial<Terminal["parser"]>; buffer?: Partial<Terminal["buffer"]> };

/** 세션을 열 때 한 번 — 돌려준 함수가 「지금 에이전트가 이 화면에 있는가」 를 답한다. 구독은 터미널과 함께 사라진다. */
export function watchAgentScreen(term: Watchable): () => boolean {
  let live = false;
  term.parser?.registerOscHandler?.(7501, (body) => {
    // 쌍은 `:` 로 가른다(`program_status.rs` 의 parse_body). 하위 기록(`id=…`, 하위 에이전트)이 지운 것은 그 기록뿐이다.
    const pairs = body.split(":").map((p) => p.replace(/\s+/g, ""));
    const clear = pairs.includes("state=clear");
    if (!(clear && pairs.some((p) => p.startsWith("id=")))) live = !clear;
    return false;
  });
  term.buffer?.onBufferChange?.((buffer) => {
    if (buffer.type === "normal") live = false;
  });
  return () => live;
}
