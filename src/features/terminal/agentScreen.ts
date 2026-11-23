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
 * 바깥 편집기(Ctrl+G, love-round 11-23) — claude 는 보통 화면으로 내려가 편집기를 띄우고, 편집기가 닫히면 대체 화면으로
 * 돌아온다. 그 사이 상태 신호는 없어(다음 턴에야 온다) 돌아온 claude 의 Shift+Enter 가 제출이 됐다. 그래서 손을 놓지
 * 않고(`state=clear` 없이) 내려간 에이전트를 잠깐 기억한다(`away`). 넘김의 모양으로 가린다:
 *  - 내려간 뒤 사람이 그 보통 화면에 아무것도 치지 않았다 — 셸에서 vim 을 열려면 쳐야 한다(치면 잊는다).
 *  - 곧바로(`HANDOFF_MS` 안) 대체 화면이 서면 그것은 편집기(vim · nano)다 — 에이전트가 아니다. 그 편집기가 내려가고 곧바로
 *    다시 서는 대체 화면이 돌아온 claude 다.
 *  - 한참 뒤에야 대체 화면이 서면 창 편집기(`code --wait` 등, 대체 화면을 안 쓴다)에서 돌아온 claude 다.
 * 틀릴 수 있는 곳: claude 가 지우지 않고 죽은 뒤 스크립트가 사람 손 없이 전체 화면 프로그램을 두 번 연달아 띄운 경우뿐 —
 * 그때 둘째 프로그램의 Shift+Enter 가 ESC CR 이 된다.
 */
import type { Terminal } from "@xterm/xterm";

/** 시험의 가짜 터미널에는 파서 · 버퍼 사건이 없을 수 있다 — 없으면 늘 「아니다」. */
type Watchable = {
  parser?: Partial<Terminal["parser"]>;
  buffer?: Partial<Terminal["buffer"]>;
  onData?: Terminal["onData"];
};

/** 화면 넘김이 이 안이면 사람 손 없이 프로그램끼리 넘긴 것이다(편집기를 띄움 · 편집기가 닫혀 돌아옴). */
export const HANDOFF_MS = 3000;

/**
 * 손을 놓지 않고 내려간 에이전트 — `out` 은 방금 내려갔다, `editor` 는 편집기가 대체 화면에 섰다, `back` 은 그 편집기가
 * 내려가 에이전트가 돌아올 차례다. `at` 은 그 일이 일어난 때.
 */
type Away = { phase: "out" | "editor" | "back"; at: number };

/**
 * 사람이 친 입력인가 — xterm 이 질의에 스스로 답한 것(장치 속성 · 커서 자리 · 포커스 보고)은 ESC 로 시작한다.
 * 대괄호 붙여넣기는 ESC 로 시작해도 사람 손이다.
 */
export function typedByPerson(data: string): boolean {
  return !data.startsWith("\x1b") || data.startsWith("\x1b[200~");
}

/** 세션을 열 때 한 번 — 돌려준 함수가 「지금 에이전트가 이 화면에 있는가」 를 답한다. 구독은 터미널과 함께 사라진다. */
export function watchAgentScreen(term: Watchable, now: () => number = Date.now): () => boolean {
  let live = false;
  let away: Away | null = null;
  term.parser?.registerOscHandler?.(7501, (body) => {
    // 쌍은 `:` 로 가른다(`program_status.rs` 의 parse_body). 하위 기록(`id=…`, 하위 에이전트)이 지운 것은 그 기록뿐이다.
    const pairs = body.split(":").map((p) => p.replace(/\s+/g, ""));
    const clear = pairs.includes("state=clear");
    if (!(clear && pairs.some((p) => p.startsWith("id=")))) {
      live = !clear;
      away = null;
    }
    return false;
  });
  term.buffer?.onBufferChange?.((buffer) => {
    const at = now();
    if (buffer.type === "normal") {
      if (live) away = { phase: "out", at };
      else if (away?.phase === "editor") away = { phase: "back", at };
      live = false;
      return;
    }
    if (!away) return;
    const quick = at - away.at < HANDOFF_MS;
    if (away.phase === "out" && quick) {
      away = { phase: "editor", at };
      return;
    }
    // 창 편집기에서 돌아왔거나(`out` 뒤 한참) 편집기가 닫히고 곧바로 돌아왔다(`back`). `back` 뒤 한참이면 다른 프로그램이다.
    live = away.phase === "out" || quick;
    away = null;
  });
  term.onData?.((data) => {
    if (away && term.buffer?.active?.type === "normal" && typedByPerson(data)) away = null;
  });
  return () => live;
}
