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
