/**
 * OSC 52 쓰기 (love-round 11-23) — tmux · ssh 너머 vim · neovim 이 「복사」 를 터미널에 맡기는 길. xterm 에는 처리기가
 * 없어 무시됐고, 원격에서 일하는 사람은 복사가 안 됐다.
 *
 * 받는 것은 쓰기(`52;<칸>;<base64>`)뿐이다:
 *  - 읽기 질의(`?`)에는 답하지 않는다 — 출력 한 줄로 클립보드(비밀번호 · 토큰)를 빼 가는 길이다.
 *  - 사람이 그 칸에 키를 누른 직후(`GESTURE_MS`)만 — `cat` 한 파일 · 남이 만든 로그가 몰래 클립보드를 바꾸지 못하게.
 *    막으면 한 번 알린다(복사를 기대한 사람이 왜 안 됐는지 알게).
 *  - 디코드한 글이 `MAX_BYTES` 를 넘으면 버린다.
 *  - 쓸 때마다 알린다(「복사했어요 (n자)」) — 클립보드가 조용히 바뀌지 않게. 글은 붙여넣기와 같은 정화기를 지난다
 *    (`pasteSafe` — 다른 앱에 붙였을 때 터미널 명령이 되지 않게).
 *
 * 쓰기는 백엔드가 한다(`terminal_clipboard.rs`) — WKWebView 는 키 사건 밖에서 부른 `navigator.clipboard` 를 거절하고,
 * 출력은 키보다 늦게 온다. 백엔드가 쓰지 않는 OS(Linux)는 웹뷰가 쓴다.
 */
import type { Terminal } from "@xterm/xterm";

import { terminalApi } from "@/api/terminal";
import { t } from "@/i18n";
import { getPlatform } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { typedByPerson } from "./agentScreen";
import { sanitizePaste } from "./pasteSafe";
import { forClipboard } from "./termCopy";

/** 디코드한 글의 상한. */
export const MAX_BYTES = 64 * 1024;
/** 사람이 키를 누른 뒤 이만큼 안의 복사만 받는다 — ssh 너머의 왕복도 넉넉히 든다. */
export const GESTURE_MS = 5000;

export type Osc52 =
  | { kind: "write"; text: string }
  /** 읽기 질의 · 빈 글(지우기) · 깨진 base64 · 상한 넘음 — 아무것도 하지 않는다. */
  | { kind: "ignore"; why: "read" | "empty" | "invalid" | "large" };

/** OSC 52 의 몸(`<칸>;<글>`, 앞의 `52;` 는 xterm 이 뗐다) → 할 일. */
export function parseOsc52(body: string): Osc52 {
  const semi = body.indexOf(";");
  if (semi < 0) return { kind: "ignore", why: "invalid" };
  const data = body.slice(semi + 1).replace(/\s+/g, "");
  if (data === "?") return { kind: "ignore", why: "read" };
  if (data === "") return { kind: "ignore", why: "empty" };
  // 디코드하기 전에 길이로 먼저 거른다 — base64 넉 자가 석 바이트다.
  if (data.length > Math.ceil(MAX_BYTES / 3) * 4) return { kind: "ignore", why: "large" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { kind: "ignore", why: "invalid" };
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return { kind: "ignore", why: "invalid" };
  }
  if (binary.length > MAX_BYTES) return { kind: "ignore", why: "large" };
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return { kind: "write", text: new TextDecoder().decode(bytes) };
}

/** 클립보드에 쓴다 — 백엔드가 쓰지 않는 OS 면 웹뷰가. 알림까지. */
export async function writeClipboard(text: string): Promise<void> {
  const clean = forClipboard(sanitizePaste(text), getPlatform() === "windows");
  try {
    const done = await terminalApi.clipboardWrite(clean);
    if (!done) await navigator.clipboard.writeText(clean);
    toast.info(t("terminal.osc52.copied", { n: [...clean].length }), {
      dedupKey: "terminal-osc52",
      dedupWindowMs: 4000,
    });
  } catch {
    toast.warning(t("terminal.osc52.failed"), { dedupKey: "terminal-osc52-failed", dedupWindowMs: 10_000 });
  }
}

type Watchable = { parser?: Partial<Terminal["parser"]>; onData?: Terminal["onData"] };

/** 세션을 열 때 한 번 — 구독은 터미널과 함께 사라진다. */
export function watchOscClipboard(
  term: Watchable,
  deps: { now?: () => number; write?: (text: string) => Promise<void> } = {},
): void {
  const now = deps.now ?? Date.now;
  const write = deps.write ?? writeClipboard;
  let typedAt = Number.NEGATIVE_INFINITY;
  term.onData?.((data) => {
    if (typedByPerson(data)) typedAt = now();
  });
  term.parser?.registerOscHandler?.(52, (body) => {
    const got = parseOsc52(body);
    if (got.kind !== "write") return true;
    if (now() - typedAt > GESTURE_MS) {
      toast.warning(t("terminal.osc52.blocked"), { dedupKey: "terminal-osc52-blocked", dedupWindowMs: 10_000 });
      return true;
    }
    void write(got.text);
    return true;
  });
}
