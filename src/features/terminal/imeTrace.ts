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

/** 이벤트 한 건. **여기서는 아무 것도 만들지 않는다** — 링에 얹기만. */
export function pushImeTrace(event: string, detail: Record<string, unknown>): void {
  ring[cursor % CAPACITY] = { at: Date.now(), event, detail };
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
 * 한 건에 한 줄씩 IPC 를 태우면 덤프 자체가 수백 번의 왕복이 된다 — 한 덩어리로
 * 묶어 **한 번** 보낸다. 사람이 부르는 순간이라 그 비용은 상관없지만, 그 사이
 * 사용자가 계속 타이핑하고 있을 수 있어서 굳이 위험을 만들지 않는다.
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
  oculpmLog.info("ime", `[IME-DUMP ${reason}] ${entries.length} events\n${lines.join("\n")}`);
  cursor = 0;
  ring.fill(undefined);
  return entries.length;
}
