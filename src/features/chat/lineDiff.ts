// 편집 diff 의 **줄 비교** (순수 함수).
//
// 백엔드는 `ToolCallContent::Diff` 의 old/new 본문을 그대로 넘긴다 — 여기서
// 줄 단위로 비교해 +/− 를 매긴다. 통합 diff 문자열을 만들지 않고 구조로 두는
// 이유: 화면이 접기·색·통계("+3 −1")를 문자열 재파싱 없이 그려야 한다.

export interface DiffLine {
  /** `ctx` 그대로 · `add` 추가 · `del` 삭제. */
  kind: "ctx" | "add" | "del";
  text: string;
}

/**
 * LCS 표를 채울 최대 칸 수.
 *
 * 편집 도구의 diff 는 대개 바뀐 조각 몇십 줄이지만, Write 도구는 파일 전체를
 * 실어 온다. 표가 이 상한을 넘으면 정밀 비교를 포기하고 "전부 삭제 + 전부
 * 추가"로 눕힌다 — 몇 초 멎는 화면보다 덜 정밀한 diff 가 낫다.
 */
const MAX_CELLS = 250_000;

/**
 * 두 본문을 줄 단위로 비교한다. `oldText` 가 없으면 전부 추가(새 파일).
 *
 * 흔한 경우(머리·꼬리가 같음)를 먼저 벗겨 내고 가운데만 LCS 를 돈다 —
 * 수백 줄짜리 파일에서 한 줄 고친 diff 가 표 전체를 채우지 않게.
 */
export function diffLines(oldText: string | null | undefined, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText ?? "");
  const newLines = splitLines(newText);
  if (oldText == null) return newLines.map((text) => ({ kind: "add" as const, text }));

  // 공통 머리.
  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  ) {
    head += 1;
  }
  // 공통 꼬리 (머리와 겹치지 않게).
  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail += 1;
  }

  const oldMid = oldLines.slice(head, oldLines.length - tail);
  const newMid = newLines.slice(head, newLines.length - tail);

  const lines: DiffLine[] = [];
  for (let i = 0; i < head; i += 1) lines.push({ kind: "ctx", text: oldLines[i] });
  lines.push(...diffMiddle(oldMid, newMid));
  for (let i = oldLines.length - tail; i < oldLines.length; i += 1) {
    lines.push({ kind: "ctx", text: oldLines[i] });
  }
  return lines;
}

/** 잘라 낸 diff — 화면이 "위/아래 몇 줄이 더 있는지"를 말할 수 있게. */
export interface DiffWindow {
  lines: DiffLine[];
  hiddenBefore: number;
  hiddenAfter: number;
}

/**
 * 접힌 카드용 창내기 — **첫 변경 지점** 둘레 `max` 줄만 남긴다.
 *
 * 머리부터 자르면 공통 문맥만 보이고 정작 바뀐 줄은 창 밖이다. 변경 직전
 * 한 줄을 문맥으로 남겨 "어디를 고쳤는지"가 첫눈에 잡히게 한다.
 */
export function focusWindow(lines: readonly DiffLine[], max: number): DiffWindow {
  if (lines.length <= max) {
    return { lines: [...lines], hiddenBefore: 0, hiddenAfter: 0 };
  }
  const firstChange = lines.findIndex((line) => line.kind !== "ctx");
  const start = Math.max(0, (firstChange === -1 ? 0 : firstChange) - 1);
  const end = Math.min(lines.length, start + max);
  return {
    lines: lines.slice(start, end),
    hiddenBefore: start,
    hiddenAfter: lines.length - end,
  };
}

/** "+N −M" 요약. 접힌 카드가 펼칠 가치를 말해 주는 숫자다. */
export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "del") removed += 1;
  }
  return { added, removed };
}

/**
 * 마지막 개행 하나는 "줄"이 아니다 — `"a\n"` 을 그대로 나누면 유령 빈 줄이
 * 생겨 diff 끝에 늘 `+`/`−` 빈 줄이 붙는다.
 */
function splitLines(text: string): string[] {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/** 머리·꼬리를 벗긴 가운데 구간의 LCS diff. 표가 크면 통짜 교체로 눕힌다. */
function diffMiddle(oldMid: readonly string[], newMid: readonly string[]): DiffLine[] {
  if (!oldMid.length) return newMid.map((text) => ({ kind: "add" as const, text }));
  if (!newMid.length) return oldMid.map((text) => ({ kind: "del" as const, text }));

  if (oldMid.length * newMid.length > MAX_CELLS) {
    return [
      ...oldMid.map((text) => ({ kind: "del" as const, text })),
      ...newMid.map((text) => ({ kind: "add" as const, text })),
    ];
  }

  // LCS 길이 표 (한 줄씩만 들고 있으면 되지만, 역추적하려면 전체가 필요하다).
  const rows = oldMid.length + 1;
  const cols = newMid.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i * cols + j] =
        oldMid[i - 1] === newMid[j - 1]
          ? table[(i - 1) * cols + (j - 1)] + 1
          : Math.max(table[(i - 1) * cols + j], table[i * cols + (j - 1)]);
    }
  }

  // 역추적 — 삭제를 추가보다 먼저 내보내야 읽는 순서가 "지웠다 → 넣었다"가 된다.
  const reversed: DiffLine[] = [];
  let i = oldMid.length;
  let j = newMid.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldMid[i - 1] === newMid[j - 1]) {
      reversed.push({ kind: "ctx", text: oldMid[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i * cols + (j - 1)] >= table[(i - 1) * cols + j])) {
      reversed.push({ kind: "add", text: newMid[j - 1] });
      j -= 1;
    } else {
      reversed.push({ kind: "del", text: oldMid[i - 1] });
      i -= 1;
    }
  }
  reversed.reverse();

  // 같은 자리의 del/add 가 섞여 나오면 del 묶음을 앞으로 모은다 — LCS 역추적은
  // add 를 먼저 뱉을 수 있는데, 눈은 "빠진 줄 → 새 줄" 순서로 읽는다.
  return groupReplacements(reversed);
}

/** 인접한 add/del 혼합 구간을 del 먼저, add 나중으로 정렬한다 (ctx 는 경계). */
function groupReplacements(lines: readonly DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    out.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === "ctx") {
      flush();
      out.push(line);
    } else if (line.kind === "del") {
      dels.push(line);
    } else {
      adds.push(line);
    }
  }
  flush();
  return out;
}
