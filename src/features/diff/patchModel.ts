/**
 * 패치 한 장을 그릴 모양으로 — 줄 번호 · 강조 HTML · 바뀐 단어 · 들여쓰기. 순수 함수라 `PatchView`
 * 가 패치 문자열을 열쇠로 한 번만 만든다(11-15 #diff-perf): 워처 이벤트 · 메모 변경마다 diff 전체를
 * 다시 파싱하고 줄마다 hljs 를 돌리던 것.
 */
import type { Hljs } from "@/lib/hljs";
import { escapeHtml, highlightLines } from "./diffHighlight";
import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  parseHunkHeader,
  splitLegacyCut,
  type PatchCut,
} from "./diffParse";
import { markRanges, wordRanges } from "./diffWords";

/** 이 줄 수를 넘는 패치는 강조하지 않는다 — 평문이 멈춘 화면보다 낫다. */
export const HIGHLIGHT_MAX_LINES = 3000;
/** 들여쓰기 매달기의 상한(칸) — 깊은 중첩이 코드 칸을 다 먹지 않게. */
const MAX_INDENT = 32;
const TAB = 4;

export interface ModelLine {
  kind: "context" | "addition" | "deletion" | "meta";
  /** 표식(+ − 공백)을 뺀 코드. 표식 줄은 원문 그대로. */
  code: string;
  oldNo: number | null;
  newNo: number | null;
  /** 이 줄의 코드 HTML — 지운 줄은 옛 쪽, 나머지는 새 쪽으로 강조하고 바뀐 단어를 덧입혔다. */
  html: string;
  /** 문맥 줄의 옛 쪽 HTML — 나란히 보기의 왼쪽(옛 쪽 문맥으로 강조). */
  oldHtml: string;
  /** 앞 공백의 칸 수 — 꺾인 줄이 이만큼 들어가 코드 칸에 매달린다. */
  indent: number;
}

export interface ModelHunk {
  header: string | null;
  lines: ModelLine[];
}

export interface PatchModel {
  hunks: ModelHunk[];
  /** 옛 표지 문장으로 잘린 패치(일지 사이드카) — 백엔드가 숫자로 준 것은 부르는 쪽이 따로 넘긴다. */
  cut: PatchCut | null;
}

function indentOf(code: string): number {
  let cols = 0;
  for (const ch of code) {
    if (ch === " ") cols += 1;
    else if (ch === "\t") cols += TAB - (cols % TAB);
    else break;
  }
  return Math.min(cols, MAX_INDENT);
}

function codeOf(text: string): string {
  const first = text.charAt(0);
  return first === "+" || first === "-" || first === " " ? text.slice(1) : text;
}

export function buildPatchModel(patch: string, lang: string | null, hljs: Hljs | null): PatchModel {
  const { body, cut } = splitLegacyCut(patch);
  const all = classifyDiffLines(body);
  const highlight = all.length <= HIGHLIGHT_MAX_LINES ? hljs : null;
  const hunks: ModelHunk[] = [];
  for (const h of groupIntoHunks(all)) {
    const raw = h.lines.filter((l) => l.kind !== "hunk" && l.kind !== "header");
    if (raw.length === 0) continue;
    const start = h.header ? parseHunkHeader(h.header.text) : null;
    let oldNo = (start?.oldStart ?? 1) - 1;
    let newNo = (start?.newStart ?? 1) - 1;
    const lines: ModelLine[] = raw.map((l) => {
      const kind = l.kind as ModelLine["kind"];
      const code = kind === "meta" ? l.text : codeOf(l.text);
      const o = kind === "context" || kind === "deletion" ? ++oldNo : null;
      const n = kind === "context" || kind === "addition" ? ++newNo : null;
      const plain = escapeHtml(code);
      return { kind, code, oldNo: o, newNo: n, html: plain, oldHtml: plain, indent: indentOf(code) };
    });
    // 옛 쪽(문맥 + 지운 줄) · 새 쪽(문맥 + 더한 줄)을 한 번씩 — 여러 줄 주석이 줄마다 끊기지 않는다.
    const oldSide = lines.filter((l) => l.kind === "context" || l.kind === "deletion");
    const newSide = lines.filter((l) => l.kind === "context" || l.kind === "addition");
    const oldHtml = highlightLines(highlight, lang, oldSide.map((l) => l.code));
    const newHtml = highlightLines(highlight, lang, newSide.map((l) => l.code));
    oldSide.forEach((l, i) => {
      if (!oldHtml) return;
      l.oldHtml = oldHtml[i];
      if (l.kind === "deletion") l.html = oldHtml[i];
    });
    newSide.forEach((l, i) => {
      if (newHtml) l.html = newHtml[i];
    });
    // 짝지은 지운 줄 · 더한 줄 — 바뀐 단어만 한 단 진하게.
    for (const { left, right } of pairDiffLines(lines)) {
      if (left?.kind !== "deletion" || right?.kind !== "addition") continue;
      const ranges = wordRanges(left.code, right.code);
      if (!ranges) continue;
      left.html = markRanges(left.html, ranges[0]);
      right.html = markRanges(right.html, ranges[1]);
    }
    hunks.push({ header: h.header?.text ?? null, lines });
  }
  return { hunks, cut };
}
