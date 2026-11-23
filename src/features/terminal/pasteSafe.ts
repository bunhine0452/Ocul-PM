/**
 * 터미널로 들어가는 바이트를 거르는 곳 하나 (2026-11-15, 업그레이드 라운드 TI-04).
 *
 * ── 왜 ───────────────────────────────────────────────────────────────────────
 * 「Claude 에게 보내기」 · 「끝까지」(/goal)는 일지 · 계획 제목을 날것으로 대괄호 붙여넣기(ESC[200~ …
 * ESC[201~)에 넣고 잠깐 뒤 CR 을 친다(`sendToClaude.deliverToSession`). 동료가 커밋한 제목에
 * `ESC[201~ CR !명령` 이 들어 있으면 붙여넣기가 거기서 일찍 닫히고, 뒤의 `!명령` 이 Claude Code 의
 * 셸 모드로 **승인 없이** 돈다. 손으로 친 ⌘V 도 같다 — xterm 5.5 는 붙여 넣는 글의 ESC 를 지우지 않는다.
 *
 * 그래서 넣기 전에 한 번 거른다: CSI · OSC 시퀀스는 통째로 지우고, 남은 ESC 는 보이는 ␛ 로 바꾸고,
 * C0(탭 · 줄바꿈 빼고) · DEL · C1 제어 문자는 버리고, CRLF · CR 은 LF 로 맞춘다. 거른 글에는 ESC 가
 * 하나도 없으니 어떤 바이트도 붙여넣기를 닫거나 터미널 명령이 되지 못한다.
 *
 * 정규식이 아니라 글자를 하나씩 훑는다 — 제어 문자를 담은 정규식은 lint 의 no-control-regex 경고
 * 예산(`--max-warnings`)을 먹고, CSI 의 문법(매개변수 · 중간 · 끝 바이트)은 상태로 적는 편이 정확하다.
 */
import { t } from "@/i18n";
import { dismissToast, getToasts, toast } from "@/lib/toast";

const ESC = 0x1b;
const BEL = 0x07;
/** 8비트 CSI · OSC · ST — UTF-8 문자열에서는 U+009B · U+009D · U+009C 로 온다. */
const CSI8 = 0x9b;
const OSC8 = 0x9d;
const ST8 = 0x9c;
/** 남은 ESC 의 보이는 자리 — 지우면 무엇이 있었는지 모른다. */
const ESC_SHOWN = "\u{241b}";

/** CSI 의 끝 — 매개변수(0x30–0x3F) · 중간(0x20–0x2F) 바이트를 지나 끝 바이트(0x40–0x7E)까지. */
function csiEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x3f) i += 1;
  while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i += 1;
  const last = text.charCodeAt(i);
  // 끝 바이트가 없는 조각(잘린 시퀀스)은 머리까지만 걷는다 — 뒤의 글자는 글로 남는다.
  return last >= 0x40 && last <= 0x7e ? i + 1 : i;
}

/** OSC 의 끝(BEL · ESC \ · ST 다음 자리) — 닫히지 않았으면 -1. */
function oscEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === BEL || c === ST8) return i + 1;
    if (c === ESC && text.charCodeAt(i + 1) === 0x5c) return i + 2;
  }
  return -1;
}

/** 터미널 입력으로 넣어도 되는 글 — 위 머리말의 규칙. */
export function sanitizePaste(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === ESC || c === CSI8 || c === OSC8) {
      const body = c === ESC ? i + 2 : i + 1;
      const kind = c === ESC ? text.charCodeAt(i + 1) : c;
      if (kind === 0x5b || kind === CSI8) {
        i = csiEnd(text, body);
        continue;
      }
      if (kind === 0x5d || kind === OSC8) {
        const end = oscEnd(text, body);
        if (end >= 0) {
          i = end;
          continue;
        }
      }
      if (c === ESC) out += ESC_SHOWN;
      i += 1;
      continue;
    }
    if (c === 0x0d) {
      out += "\n";
      i += text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      continue;
    }
    const control = c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f);
    if (!control || c === 0x09 || c === 0x0a) out += text[i];
    i += 1;
  }
  return out;
}

/** 클립보드에 그림이 있는가 — 스크린숏만 든 ⌘V 는 text/plain 이 비고 이것만 있다. */
export function clipboardHasImage(data: DataTransfer): boolean {
  const isImage = (type: string) => type.startsWith("image/");
  if (data.items && Array.from(data.items).some((item) => isImage(item.type))) return true;
  if (data.files && Array.from(data.files).some((file) => isImage(file.type))) return true;
  return Array.from(data.types ?? []).some(isImage);
}

/** 붙여넣기가 쓰는 xterm 의 몫 — 시험이 가짜로 갈아 끼운다. */
export interface PasteTerm {
  paste(text: string): void;
  input(data: string, wasUserInput?: boolean): void;
  focus(): void;
  readonly modes: { readonly bracketedPasteMode: boolean };
  readonly buffer: { readonly active: { readonly type: string } };
}

/**
 * Claude Code 가 클립보드의 그림을 읽는 키 — 맥 · 리눅스 ⌃V(0x16), Windows Alt+V(ESC v).
 * 브라우저의 붙여넣기 이벤트는 그림을 글로 줄 수 없으니, 그 키를 대신 친다.
 */
export function imagePasteKey(windows: boolean): string {
  return windows ? "\x1bv" : "\x16";
}

/** PSReadLine 의 Paste 키(Windows 편집 모드의 Ctrl+V) — ConPTY 가 0x16 을 Ctrl+V 키로 옮긴다. */
const PSREADLINE_PASTE = "\x16";

/** 줄 수 — 끝의 줄바꿈 하나는 줄로 세지 않는다("ls\n" 은 한 줄이다). */
function lineCount(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

/**
 * 경고를 띄운 붙여넣기 — 토스트가 떠 있는 동안 **같은 글을 한 번 더 붙이면** 그대로 붙인다. 토스트는
 * 포커스를 받지 않고 Tab · ⇧Tab 은 xterm 이 셸로 보내므로, 키보드만 쓰는 사람에게는 이것이 「붙여넣기」
 * 단추에 닿는 길이다(경고 문구가 그 길을 적는다). 경고는 늘 한 장 — 다른 글을 붙이면 앞 경고를 거두고
 * 새로 띄운다. 같은 경고 두 장을 둘 다 눌러 두 번 붙는 일이 없게.
 */
let pending: { term: PasteTerm; text: string; toast: number } | null = null;

function warnMultiline(term: PasteTerm, text: string): void {
  const prev = pending;
  pending = null;
  if (prev) {
    const shown = getToasts().some((item) => item.id === prev.toast);
    dismissToast(prev.toast);
    if (shown && prev.term === term && prev.text === text) {
      term.paste(text);
      return;
    }
  }
  const id = toast.warning(t("terminal.paste.multiline", { n: lineCount(text) }), {
    actions: [
      {
        label: t("terminal.paste.anyway"),
        onClick: () => {
          if (pending?.toast === id) pending = null;
          term.paste(text);
          term.focus();
        },
      },
    ],
  });
  if (id !== null) pending = { term, text, toast: id };
}

/**
 * host 캡처 단계의 붙여넣기 (TI-04) — xterm 의 처리기 대신 여기서 붙인다.
 *
 *   ① 글이 없고 그림만 있다 → 대체 화면(Claude · Codex)이면 그림 붙여넣기 키를 친다. 셸(보통 화면)에
 *      ⌃V 를 보내면 readline 의 quoted-insert 가 다음 키를 글자로 삼키므로 아무것도 하지 않는다.
 *   ② 글이 있다 → 걸러서 `term.paste` — 안의 프로그램이 대괄호 붙여넣기를 켰으면 xterm 이 감싼다.
 *   ③ 대괄호를 안 켠 프로그램(맥의 /bin/bash 3.2 · less · vi)에 여러 줄 → 붙이지 않고 묻는다. 줄마다
 *      Enter 가 되어 경고 없이 실행되기 때문이다. 대체 화면도 묻는다 — less 의 `!` · vi 의 `:!` 는
 *      붙인 줄을 셸 명령으로 돌린다.
 *   ④ 다만 Windows 셸(보통 화면)에는 묻지 않고 PSReadLine 에 맡긴다. PowerShell 은 대괄호 붙여넣기를
 *      켜지 않지만 PSReadLine 의 Paste(⌃V)가 클립보드를 직접 읽어 실행하지 않고 한 덩어리로 입력줄에
 *      넣는다 — 예전 Ctrl+V 가 하던 그대로다. 경고도, 줄마다 실행도 없다.
 *   ⑤ Finder · 탐색기에서 복사한 파일 → 경로를 붙인다(`files`, `filePaste.ts` — 11-23). 웹뷰가 주는 글은 파일
 *      이름뿐이라 그보다 먼저 본다. 경로를 못 얻으면(그림만 든 클립보드) 위 ①~④ 그대로.
 */
export function handlePaste(
  term: PasteTerm,
  event: ClipboardEvent,
  windows: boolean,
  files?: (data: DataTransfer) => Promise<string> | null,
): void {
  const data = event.clipboardData;
  if (!data) return; // 읽을 것이 없다 — xterm 에게 맡긴다
  event.preventDefault();
  event.stopPropagation();
  const raw = data.getData("text/plain");
  const image = clipboardHasImage(data);
  const paths = files?.(data);
  if (!paths) return pasteText(term, raw, image, windows);
  void paths
    .catch(() => "")
    .then((text) => (text ? term.paste(text) : pasteText(term, raw, image, windows)));
}

/** 글 붙여넣기 — 위 ①~④. */
function pasteText(term: PasteTerm, raw: string, image: boolean, windows: boolean): void {
  const alt = term.buffer.active.type === "alternate";
  if (!raw) {
    if (image && alt) term.input(imagePasteKey(windows), true);
    return;
  }
  const clean = sanitizePaste(raw);
  if (!clean) return;
  if (!term.modes.bracketedPasteMode && clean.includes("\n")) {
    if (windows && !alt) term.input(PSREADLINE_PASTE, true);
    else warnMultiline(term, clean);
    return;
  }
  term.paste(clean);
}
