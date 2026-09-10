// 재접속 스크롤백을 **찍힌 폭 그대로** 재생한다 (2026-09-11)
//
// ── 증상 ──────────────────────────────────────────────────────────────────
// ⌘J 도크(좁음)에서 claude code 를 쓰다 터미널 화면(넓음)으로 돌아오면, 또는
// 그 반대로 가면, 그때까지의 대화가 찌부러진 채 굳는다 — 줄이 겹치고, 같은
// 문단이 두 번 보이고, 위로 올려도 그대로다.
//
// ── 원인 ──────────────────────────────────────────────────────────────────
// 도크와 화면은 같은 세션을 그리지만 xterm 은 각자 새로 만든다. 새 xterm 은
// 호스트의 스크롤백(바이트 그대로)을 **자기 폭**으로 재생했다. 그런데 그 바이트
// 안의 "커서를 N 줄 올려 지우고 다시 쓴다" 는 찍힐 당시의 폭으로 계산된 것이라,
// 다른 폭에서 해석하면 지운다고 믿은 줄이 안 지워지고 접힌 줄이 겹친다. 폭이
// 몇 칸만 달라도 그렇다 — 그래서 `adoptedCols` 로 폭을 이어받아도 이미 재생이
// 끝난 뒤라 소용이 없었다.
//
// ── 고치는 방법 ───────────────────────────────────────────────────────────
// 호스트가 스냅샷과 함께 "이 오프셋부터는 rows×cols 였다" 를 돌려준다
// (`scrollback.rs` 의 크기 마커). 구간마다 xterm 을 그 크기로 맞춘 뒤 쓴다 —
// 셸이 실제로 본 순서·크기 그대로다. 재생이 끝난 뒤 컨테이너에 맞추면 폭이
// 바뀐 구간은 xterm 의 리플로(soft wrap)가 다루는 평범한 줄바꿈으로 남고,
// 다시 넓히면 다시 펴진다.
//
// 남는 한계: TUI 가 **좁은 폭에서 새로 찍은** 줄은 그 개행이 진짜 문자라 어떤
// 리플로도 펴지 못한다. 그건 iTerm2 도 같다 — 여기서 고치는 것은 "찍힐 때는
// 멀쩡했던 줄이 옮겨 오는 도중에 망가지는" 경로다.

/** 스냅샷 텍스트의 `at`(UTF-16 단위 오프셋)부터 PTY 가 `rows`×`cols` 였다. */
export interface SizeMark {
  at: number;
  rows: number;
  cols: number;
}

export interface ReplaySegment {
  /** 0 이면 모른다 — 크기를 건드리지 않고 쓴다. */
  rows: number;
  cols: number;
  text: string;
}

/**
 * 스냅샷을 "크기 → 텍스트" 구간으로 자른다. 순수 함수.
 *
 * - 마커는 오름차순으로 정렬하고, 텍스트 밖(`at > length`)은 끝으로 접는다.
 * - 첫 마커 앞의 텍스트는 크기를 모르는 구간이다 (구버전 호스트의 링에서
 *   밀려난 뒤라면 그렇다) — 크기 0 으로 두어 호출측이 건드리지 않게 한다.
 * - 같은 자리의 마커는 마지막 것이 이긴다.
 * - 텍스트가 끝난 자리의 마커는 **빈 구간으로 남긴다** — 재생이 끝났을 때
 *   xterm 이 세션의 지금 크기에 있어야 이어받기(`adoptedCols`)가 뜻대로 된다.
 */
export function splitReplay(text: string, sizes: readonly SizeMark[]): ReplaySegment[] {
  const valid = sizes
    .filter((m) => Number.isFinite(m.at) && m.rows > 0 && m.cols > 0)
    .map((m) => ({ ...m, at: Math.max(0, Math.min(text.length, Math.floor(m.at))) }))
    .sort((a, b) => a.at - b.at);
  if (valid.length === 0) return text ? [{ rows: 0, cols: 0, text }] : [];

  const segments: ReplaySegment[] = [];
  const first = valid[0]!;
  if (first.at > 0) segments.push({ rows: 0, cols: 0, text: text.slice(0, first.at) });
  for (let i = 0; i < valid.length; i++) {
    const mark = valid[i]!;
    const next = valid[i + 1];
    // 같은 자리에 다음 마커가 있으면 이 마커는 아무 바이트도 못 봤다 — 건너뛴다.
    if (next && next.at === mark.at) continue;
    const end = next ? next.at : text.length;
    segments.push({ rows: mark.rows, cols: mark.cols, text: text.slice(mark.at, end) });
  }
  return segments;
}

/** `replayInto` 가 실제로 쓰는 것만 추린 표면 — 테스트에서 가짜를 세우기 위해. */
export interface ReplayTarget {
  resize(cols: number, rows: number): void;
  write(data: string, callback?: () => void): void;
}

/**
 * 구간을 순서대로 재생한다. `resize` 는 동기지만 `write` 는 xterm 의 쓰기
 * 큐를 타고 **나중에** 파싱되므로, 다음 구간의 `resize` 는 앞 구간의 콜백이
 * 온 뒤에 불러야 한다 — 안 그러면 마지막 크기로 전부를 해석해 버려 고치려던
 * 그 증상이 그대로 남는다.
 */
export async function replayInto(term: ReplayTarget, segments: readonly ReplaySegment[]): Promise<void> {
  for (const seg of segments) {
    if (seg.rows > 0 && seg.cols > 0) term.resize(seg.cols, seg.rows);
    if (!seg.text) continue;
    await new Promise<void>((resolve) => term.write(seg.text, resolve));
  }
}
