// 논의 편집기의 문서 구조 읽기 — 개요 · 현재 섹션 · 글자 수 · 미리보기 정리 (순수).
//
// 편집기·개요·상태줄이 같은 판독을 써야 "왼쪽 개요가 가리키는 섹션" 과 "상태줄이
// 말하는 섹션" 이 어긋나지 않는다. 그래서 판독은 여기 한 곳이고, 섹션 종류는
// 파서 키워드 표(`mdEdit.sectionOf` = `parse.rs::section_of`)를 그대로 쓴다.

import { sectionOf, type SectionKind } from "./mdEdit";

export interface OutlineItem {
  /** `##` 는 섹션, `###` 는 그 안의 후보 방안 같은 하위 항목. */
  level: 2 | 3;
  /** `{#id}` 를 뗀 제목. */
  title: string;
  /** 1-base 줄 번호 (Monaco 와 같은 단위). */
  line: number;
  /** `##` 는 자기 판정, `###` 는 속한 섹션의 판정을 물려받는다. */
  kind: SectionKind;
}

/** 줄 끝의 안정 id (`{#opt-a}` · `{#next-2}`). 삽입 메뉴가 만들고 파서가 읽는다. */
const STABLE_ID = /[ \t]*\{#[\w-]+\}[ \t]*$/;

/**
 * `##`·`###` 제목의 목록. 코드 펜스 안의 `## …` 은 제목이 아니다 — 마크다운
 * 렌더러도 그렇게 그리므로 미리보기의 h2/h3 순서와 이 목록의 순서가 같다.
 */
export function parseOutline(doc: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let fence: string | null = null;
  let section: SectionKind = "unknown";
  doc.split("\n").forEach((raw, i) => {
    const trimmed = raw.trim();
    const marker = /^(```|~~~)/.exec(trimmed)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (!m) return;
    const title = m[2].replace(STABLE_ID, "").trim();
    if (!title) return;
    const level = m[1].length as 2 | 3;
    if (level === 2) section = sectionOf(title);
    out.push({ level, title, line: i + 1, kind: section });
  });
  return out;
}

/** `line` 이 속한 개요 항목의 인덱스 — 첫 제목보다 위면 -1. */
export function outlineIndexAt(items: readonly OutlineItem[], line: number): number {
  let found = -1;
  for (let i = 0; i < items.length && items[i].line <= line; i++) found = i;
  return found;
}

/**
 * 미리보기용 원문 — 파서가 읽는 뼈대를 읽는 판에서 걷는다. 원문은 그대로다.
 * - 줄 끝의 `{#id}`.
 * - 혼자 선 HTML 주석 줄(토의 로그 경계 `<!-- oculpm:discussion-log … -->`) —
 *   렌더러가 원시 HTML 을 받지 않아(XSS 문) 주석이 글자로 찍혔다.
 */
export function previewText(md: string): string {
  return md
    .split("\n")
    .filter((line) => !/^\s*<!--.*-->\s*$/.test(line))
    .map((line) => line.replace(STABLE_ID, ""))
    .join("\n");
}

/**
 * 상태줄의 분량. 글자 수는 공백을 뺀 수(원고지 관례), 단어는 공백으로 가른 덩어리다.
 * 토의 로그 경계 주석은 사람이 쓴 글이 아니라 뺀다.
 */
export function textStats(doc: string): { chars: number; words: number } {
  const body = doc.replace(/<!--[\s\S]*?-->/g, "");
  const chars = body.replace(/\s/g, "").length;
  const words = body.split(/\s+/).filter(Boolean).length;
  return { chars, words };
}
