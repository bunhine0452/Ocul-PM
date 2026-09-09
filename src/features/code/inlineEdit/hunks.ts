// ⌘K 제안의 **조각 승인** — 순수 모델 (Phase 5 `{#agent-hunk}`).
//
// 모델이 돌려준 대체 텍스트를 원문과 줄 단위로 비교해 **조각(hunk)** 으로
// 나누고, 조각마다 켜고 끈 상태로 본문을 다시 조립한다. 전부 받기/전부 버리기는
// 그 특수한 경우다 (`accepted` 가 전부 참/거짓).
//
// 왜 순수한가: 조립이 한 줄이라도 어긋나면 **사용자 코드가 조용히 망가진다**.
// 편집기를 띄우지 않고 규칙만 보는 자리가 필요하다 (`mdEdit.ts` 와 같은 잣대).
//
// 비교 자체는 `features/chat/lineDiff.ts` 의 `diffLines` 를 그대로 쓴다 — ACP
// 편집 패널이 쓰던 것이고, diff 를 두 벌 만들면 같은 변경이 두 화면에서 다르게
// 보인다.

import { diffLines, type DiffLine } from "@/features/chat/lineDiff";

/** 바뀐 자리 하나. `removed` 는 원문의 줄, `added` 는 제안의 줄. */
export interface Hunk {
  /** 0-based 순번 — 화면의 토글이 이 값으로 말한다. */
  index: number;
  removed: string[];
  added: string[];
}

/**
 * 조각으로 나눈다 — `del`/`add` 가 **이어지는 구간**이 한 조각이다.
 *
 * 사이에 `ctx` 가 한 줄이라도 있으면 끊는다. VS Code 의 diff 조각과 같은
 * 규칙이고, 이 문서에서 사람이 "여기까지" 라고 느끼는 경계이기도 하다.
 */
export function toHunks(diff: readonly DiffLine[]): Hunk[] {
  const out: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of diff) {
    if (line.kind === "ctx") {
      current = null;
      continue;
    }
    if (!current) {
      current = { index: out.length, removed: [], added: [] };
      out.push(current);
    }
    if (line.kind === "del") current.removed.push(line.text);
    else current.added.push(line.text);
  }
  return out;
}

/** 조립 결과 — 본문과, 받은 조각이 그 안에서 차지한 **0-based 줄 범위**. */
export interface Composed {
  lines: string[];
  /** `spans[i]` 는 `i` 번째 조각의 자리. 안 받은 조각은 `null` (그릴 것이 없다). */
  spans: ({ start: number; end: number } | null)[];
}

/**
 * 조각을 켠 대로 본문을 다시 만든다.
 *
 * 켠 조각은 `added` 를, 끈 조각은 `removed` 를 싣는다 — 즉 **끈 조각은 원문
 * 그대로**다. `ctx` 는 언제나 지나간다.
 *
 * `spans` 를 함께 내는 이유: 편집기가 받은 조각만 초록으로 칠하고 그리로
 * 스크롤해야 하는데, 그 좌표를 화면에서 다시 세면 여기와 어긋난다.
 */
export function compose(diff: readonly DiffLine[], accepted: readonly boolean[]): Composed {
  const lines: string[] = [];
  const spans: ({ start: number; end: number } | null)[] = [];
  let hunk = -1;
  let inHunk = false;

  for (const line of diff) {
    if (line.kind === "ctx") {
      lines.push(line.text);
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      hunk += 1;
      inHunk = true;
      spans[hunk] = null;
    }
    const take = accepted[hunk] ?? true;
    if (take && line.kind === "add") {
      const at = lines.length;
      lines.push(line.text);
      const span = spans[hunk];
      spans[hunk] = span ? { start: span.start, end: at } : { start: at, end: at };
    } else if (!take && line.kind === "del") {
      lines.push(line.text);
    }
  }
  return { lines, spans };
}

/** 조각별 `+n −m`. 화면이 토글 옆에 그린다. */
export function hunkStats(hunk: Hunk): { added: number; removed: number } {
  return { added: hunk.added.length, removed: hunk.removed.length };
}

/**
 * 한 번에 쓰는 진입점 — 원문과 제안에서 조각과 첫 조립을 만든다.
 *
 * 처음에는 **전부 받은 상태**로 시작한다. 사용자가 ⌘K 를 누른 것은 고쳐 달라는
 * 뜻이므로, 기본값이 "아무것도 안 바뀜" 이면 한 번 더 눌러야 결과를 본다.
 */
export function prepare(
  original: string,
  proposal: string,
): { diff: DiffLine[]; hunks: Hunk[]; accepted: boolean[] } {
  const diff = diffLines(original, proposal);
  const hunks = toHunks(diff);
  return { diff, hunks, accepted: hunks.map(() => true) };
}

/** 조립된 줄들을 원문의 끝 개행 규약에 맞춰 문자열로. */
export function joinLines(lines: readonly string[], original: string): string {
  const text = lines.join("\n");
  return original.endsWith("\n") ? text + "\n" : text;
}

export type { DiffLine };
