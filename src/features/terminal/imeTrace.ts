// 릴리스 빌드에서도 살아 있는 IME 입력 추적 (2026-08-20).
//
// ── 왜 필요한가 ───────────────────────────────────────────────────────────
// 터미널 한글 입력 버그는 네 번 재발했고(v2.13.1·2·3, 그리고 이번), 그때마다
// 제보 상황의 트레이스를 **얻지 못한 채** 고쳐야 했다. 기존 `TRACE` 가
// `import.meta.env.DEV` 라 릴리스 빌드에서는 한 줄도 안 남기 때문이다.
//
// 그렇다고 그 로그를 그대로 켤 수는 없다. `oculpmLog` 는 호출마다 IPC 를 타는데,
// 이 버그는 **입력 경로가 빨라야만 열리는 타이밍 경합**이라 로그를 켜는 순간
// 재현이 사라진다 (v2.13.3 일지: "dev 에서는 재현되지 않고 릴리스 빌드에서만").
// 진단이 관측 대상을 바꿔 버리는 것이다.
//
// ── 그래서 이렇게 ─────────────────────────────────────────────────────────
// 이벤트는 **메모리 링 버퍼에만** 쌓는다 — 배열 한 칸 쓰기, 문자열 포매팅도
// 직렬화도 없다. 실제로 로그로 나가는 것은 사람이 부를 때뿐이고, 그때 한 번에
// 비운다. 관측 비용을 재현 시점에서 덤프 시점으로 옮기는 것이 요지다.

import { t } from "@/i18n";
import { oculpmLog } from "@/lib/oculpmLog";

/** 한 번 덤프로 되돌아볼 이벤트 수. 조합 한 세션이 보통 10~30건이다. */
const CAPACITY = 400;

interface Entry {
  at: number;
  event: string;
  detail: Record<string, unknown>;
}

const ring: (Entry | undefined)[] = new Array(CAPACITY);
let cursor = 0;

// ── 입력 내용은 한글만 남긴다 (2026-11-15, 업그레이드 라운드 TI-05) ──────────────────────────
// 링은 모든 keydown 의 key 와 PTY 로 간 짧은 입력(termStore 의 pty-write)을 담는다. ⌃⌥⇧I · 자동
// 덤프로 oculpm.log 에 비울 때 sudo 비밀번호까지 한 글자씩 남았다 — 로그 마스킹은 키 패턴 정규식이라
// 흩어진 글자를 못 잡고, 이 덤프는 사용자에게 보내 달라고 하는 물건이다.
//
// 그래서 **얹는 순간** 꼴로 바꾼다: 한글 · 자모, 빈칸(조합 버그의 절반이 스페이스다), 이름 있는 키
// (Backspace · Process), 제어 바이트의 이름(DEL · ^C)만 그대로, 그 밖의 글자는 「·」. 글자 수와 순서는
// 남으므로 "몇 번 나갔나" 는 그대로 읽힌다. 숫자로 글자를 드러내는 칸(keyCode 65 = A)도 같이 가린다 —
// 229(조합 중)와 이름 있는 키의 코드는 남는다.

/** 가린 글자 하나의 자리. */
const MASK = "\u{b7}";
/** 입력 내용이 아니라 이벤트의 이름인 칸 — 그대로 둔다. */
const NAME_FIELDS = new Set(["inputType"]);
/** KeyboardEvent.key 의 이름 있는 키 — 「Backspace」 · 「Process」 · 「F12」. 한 글자 키만 내용이다. */
const NAMED_KEY = /^[A-Z][A-Za-z0-9]+$/;

/** 남겨도 되는 글자 — 한글 자모(U+1100–11FF) · 호환 자모(U+3130–318F) · 완성형(U+AC00–D7A3) · 빈칸. */
function keepsChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    cp === 0x20 ||
    cp === 0xa0
  );
}

/** 글 하나를 꼴로 — 제어 바이트는 이름으로(DEL · ^C · ^M), 남길 수 없는 글자는 「·」. */
function shapeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (keepsChar(cp)) out += ch;
    else if (cp === 0x7f) out += "DEL";
    else if (cp < 0x20) out += `^${String.fromCharCode(cp + 0x40)}`;
    else out += MASK;
  }
  return out;
}

/** JSON 문자열 그대로 온 값(termStore 의 `pty-write` 는 `JSON.stringify(data)` 를 싣는다)은 안을 본다. */
function shapeString(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const inner: unknown = JSON.parse(value);
      if (typeof inner === "string") return `"${shapeText(inner)}"`;
    } catch {
      // JSON 이 아니다 — 아래에서 글로 본다
    }
  }
  return shapeText(value);
}

/** 인쇄되는 글자의 keyCode — 숫자 · 글자 · 숫자판 · 문장부호. */
function isPrintableKeyCode(code: number): boolean {
  return (code >= 48 && code <= 90) || (code >= 96 && code <= 111) || (code >= 186 && code <= 222);
}

function shapeField(name: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (NAME_FIELDS.has(name)) return value;
    if (name === "key" && NAMED_KEY.test(value)) return value;
    return shapeString(value);
  }
  if (typeof value === "number") {
    if (name === "keyCode" && isPrintableKeyCode(value)) return MASK;
    if (name === "charCode" && value >= 0x20 && value !== 0x7f && !keepsChar(value)) return MASK;
  }
  return value;
}

/** 링에 얹을 꼴 — `imeBridge` 의 개발 빌드 로그도 같은 꼴을 쓴다. */
export function shapeImeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(detail)) out[name] = shapeField(name, value);
  return out;
}

/**
 * 이벤트 한 건 — 링에 얹기만 한다(직렬화 · IPC 없음). 입력 내용은 얹는 순간 꼴로 바꾼다(위 주석) —
 * 키 하나에 객체 하나를 새로 짓는 값이고, IPC 와 달리 입력 경합의 타이밍을 바꾸지 않는다.
 */
export function pushImeTrace(event: string, detail: Record<string, unknown>): void {
  ring[cursor % CAPACITY] = { at: Date.now(), event, detail: shapeImeDetail(detail) };
  cursor += 1;
}

/** 오래된 것부터 순서대로. */
function drain(): Entry[] {
  const out: Entry[] = [];
  const from = cursor <= CAPACITY ? 0 : cursor - CAPACITY;
  for (let at = from; at < cursor; at += 1) {
    const entry = ring[at % CAPACITY];
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * 링을 로그 파일로 비운다 (`<app_data>/logs/oculpm.log.*`).
 *
 * 한 건에 한 줄씩 IPC 를 태우면 덤프 자체가 수백 번의 왕복이 된다 — 묶어서
 * 보낸다. 다만 로그 한 줄의 상한(8KB) 안으로 — 400건이면 대여섯 조각이다 (`flush`).
 * 사람이 부르는 순간이라 그 비용은 상관없지만, 그 사이 사용자가 계속 타이핑하고
 * 있을 수 있어서 굳이 위험을 만들지 않는다.
 */
export function dumpImeTrace(reason: string): number {
  const entries = drain();
  if (!entries.length) return 0;
  return flush(reason, entries);
}

/**
 * 자동 덤프의 예산 — 코드가 "모양이 수상하다" 고 판단해 부르는 자리용
 * (`imeBridge` 의 post-commit-passthrough). 사람이 ⌃⌥⇧I 로 부르는
 * `dumpImeTrace` 는 예산을 타지 않는다.
 *
 * 왜: 그 판정이 **정상 한글 타이핑에서 분당 1회꼴**로 걸렸다 (2026-09-12 로그
 * 집계 — 하루 최대 1,264회, 12일간 5,500회, 매일 로그의 85~90%). 덤프 하나가
 * 타이핑 도중 5~20KB 를 직렬화해 IPC 로 보내니, 이 모듈 머리말이 경고한 "진단이
 * 관측을 바꾼다" 가 상시로 일어나고 있었다. 첫 몇 번은 그대로 남겨 재현 시점의
 * 흐름을 잃지 않고, 그 뒤로는 간격을 둔다 — 같은 모양이 계속 걸린다면 400번째
 * 덤프가 3번째보다 더 알려 주는 것은 없다.
 */
const AUTO_DUMP_FREE = 3;
const AUTO_DUMP_INTERVAL_MS = 10 * 60_000;
let autoDumps = 0;
let lastAutoDumpAt = 0;
/** 예산에 막혀 버린 횟수 — 다음 덤프 머리에 붙여, 사이가 조용했던 게 아님을 남긴다. */
let autoSuppressed = 0;

export function dumpImeTraceAuto(reason: string, now: number = Date.now()): number {
  const overFree = autoDumps >= AUTO_DUMP_FREE;
  if (overFree && now - lastAutoDumpAt < AUTO_DUMP_INTERVAL_MS) {
    autoSuppressed += 1;
    return 0;
  }
  const entries = drain();
  if (!entries.length) return 0;
  autoDumps += 1;
  lastAutoDumpAt = now;
  const tag = autoSuppressed > 0 ? `${reason} (+${autoSuppressed} suppressed)` : reason;
  autoSuppressed = 0;
  return flush(tag, entries);
}

/** 테스트용 — 예산 카운터를 처음으로. */
export function resetImeTraceBudget(): void {
  autoDumps = 0;
  lastAutoDumpAt = 0;
  autoSuppressed = 0;
}

/**
 * 덤프 한 조각의 바이트 상한 — 백엔드 `oculpm_log` 이 메시지를 8KB 에서 자른다
 * (`commands/oculpm.rs` LOG_MESSAGE_CAP, 2026-08-30). 400건 덤프는 30~45KB 라
 * 한 덩어리로 보내면 **뒤쪽, 곧 덤프를 부른 재현 순간이** 잘려 나갔다 (2026-11-11
 * 설치본의 자동 덤프 일곱 개가 모두 「… (+3만 bytes)」 로 끝났다). 머리 줄 몫을 남기고
 * 줄 단위로 나눈다.
 */
const PART_BYTES = 7_600;
const utf8 = new TextEncoder();

function flush(reason: string, entries: Entry[]): number {
  const base = entries[0].at;
  const lines = entries.map((entry) => {
    const offset = String(entry.at - base).padStart(6, " ");
    let detail: string;
    try {
      detail = JSON.stringify(entry.detail);
    } catch {
      detail = "<unserializable>";
    }
    return `${offset}ms ${entry.event} ${detail}`;
  });
  const parts: string[][] = [];
  let part: string[] = [];
  let size = 0;
  for (const line of lines) {
    const bytes = utf8.encode(line).length + 1;
    if (part.length && size + bytes > PART_BYTES) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(line);
    size += bytes;
  }
  parts.push(part);
  // 첫 조각만 `[IME-DUMP` 로 연다 — 덤프 수를 세는 쪽(로그 grep · 테스트)이 조각을
  // 덤프로 세지 않게. 이어지는 조각은 같은 사유를 달아 이어 붙일 수 있게 한다.
  // 첫 머리에 「입력 내용은 한글만 남겼어요」 — 「·」 가 잘린 로그가 아니라 가린 것임을 읽는 사람에게.
  const redacted = t("terminal.imeTrace.redacted");
  parts.forEach((chunk, index) => {
    const head =
      index === 0
        ? `[IME-DUMP ${reason}] ${entries.length} events${parts.length > 1 ? ` (1/${parts.length})` : ""} · ${redacted}`
        : `[ime-dump ${reason}] (${index + 1}/${parts.length})`;
    oculpmLog.info("ime", `${head}\n${chunk.join("\n")}`);
  });
  cursor = 0;
  ring.fill(undefined);
  return entries.length;
}
