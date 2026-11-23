/**
 * 진짜 xterm 위의 입력 브리지 — 터미널 입력 시험들(term_keys · ime_cases · paste_safe · term_copy ·
 * send_terminal_selection)이 같이 쓴다.
 *
 * 가짜 터미널은 "xterm 이 이 키를 보낼 것" 을 시험이 가정해야 했다. 진짜 xterm 을 jsdom 에 열면
 * keydown · keypress · input · paste · copy 가 실제 처리기(`_keyDown` · `_keyPress` · Clipboard.ts)를
 * 지나고, PTY 로 나갈 바이트는 `onData` 에 그대로 모인다. 합성 이벤트에는 브라우저의 기본 동작이
 * 없으니(keypress 를 대신 쏘거나 textarea 에 글을 넣는 일) 사례마다 시험이 그 순서를 적는다.
 */
import { Terminal } from "@xterm/xterm";

import { watchAgentScreen } from "@/features/terminal/agentScreen";
import { attachImeBridge } from "@/features/terminal/imeBridge";

export interface RealTerm {
  term: Terminal;
  host: HTMLElement;
  textarea: HTMLTextAreaElement;
  /** PTY 로 나간 순서 그대로 — xterm 이 보낸 것과 브리지가 보낸 것이 섞여 있다. */
  data: string[];
  write(text: string): Promise<void>;
  dispose(): void;
}

export function openRealTerm(opts: { cols?: number; rows?: number; now?: () => number } = {}): RealTerm {
  // jsdom 에는 canvas 가 없다 — 열 때마다 xterm 이 글자 폭을 재려다 「Not implemented」 를 찍지 않게
  // (모듈을 들일 때의 한 번(Color.ts)은 여기보다 앞서 지나간다).
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const term = new Terminal({ cols: opts.cols ?? 40, rows: opts.rows ?? 6, allowProposedApi: true, macOptionIsMeta: true });
  // 세션 저장소(`termStore`)와 같은 배선 — 에이전트 신호는 열 때부터 보고, 브리지가 그것을 묻는다.
  const agent = watchAgentScreen(term, opts.now);
  term.open(host);
  const bridge = attachImeBridge(term, host, agent);
  const data: string[] = [];
  const sub = term.onData((d) => data.push(d));
  return {
    term,
    host,
    textarea: term.textarea as HTMLTextAreaElement,
    data,
    write: (text) => new Promise<void>((resolve) => term.write(text, () => resolve())),
    dispose() {
      sub.dispose();
      bridge.dispose();
      term.dispose();
      host.remove();
    },
  };
}

/** 키 이벤트 하나를 textarea 에 — 돌려준 이벤트의 `defaultPrevented` 로 xterm · 브리지가 막았는지 본다. */
export function fireKey(rt: RealTerm, type: "keydown" | "keypress" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  rt.textarea.dispatchEvent(event);
  return event;
}

/** 입력기가 textarea 를 `value` 로 바꾸며 쏘는 input. */
export function fireInput(rt: RealTerm, value: string, inputType = "insertText"): void {
  rt.textarea.value = value;
  rt.textarea.dispatchEvent(new InputEvent("input", { inputType, data: value, bubbles: true, composed: true }));
}

/** 표준 조합 모델의 compositionstart / update / end. */
export function fireComposition(rt: RealTerm, type: string, data: string): void {
  rt.textarea.dispatchEvent(new CompositionEvent(type, { data, bubbles: true, composed: true }));
}

/** clipboardData 를 실은 paste · copy — jsdom 에는 ClipboardEvent · DataTransfer 가 없어 손으로 붙인다. */
export function fireClipboard(rt: RealTerm, type: "paste" | "copy", clipboardData: Partial<DataTransfer>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  rt.textarea.dispatchEvent(event);
  return event;
}

/** 글 · 그림을 담은 가짜 클립보드. `written` 이 copy 가 쓴 글을 받는다. */
export function fakeClipboard(text: string, types: string[] = []): Partial<DataTransfer> & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  const items = types.map((type) => ({ kind: "file", type }));
  return {
    written,
    getData: (format: string) => (format === "text/plain" ? text : ""),
    setData: (format: string, value: string) => {
      written[format] = value;
    },
    items: items as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    types: [...(text ? ["text/plain"] : []), ...types],
  };
}
