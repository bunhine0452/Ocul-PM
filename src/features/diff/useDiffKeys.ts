/**
 * 변경 화면의 키 (11-15 #diff-keys) — 화면 루트가 듣는다(입력칸 안은 빼고). 치트시트(⌘/)의 DIFF
 * 묶음(`shortcutRegistry`)이 이 표를 그대로 옮겨 적는다: 알린 키 = 듣는 키. 예전 표는 화면에 없는
 * 키 셋(/ · n/N · f)을 알렸고 화면은 j/k 만 들었다.
 *
 *   j / k   파일        [ / ]   일지 묶음       n / p   파일 안 덩이
 *   ⌥n      다음 메모   e       편집기에서 그 줄  v       봤음
 *
 * 두벌식이면 한 글자 키가 ㅓ · ㅏ · ㅜ · ㅔ · ㄷ · ㅍ 로 온다(`e.key`) — 라틴 글자가 아니면 자리(`e.code`)로
 * 라틴 글자를 되찾는다. `readChord` 는 맥 · 비-mac 무수식 갈래 모두 `e.key` 를 그대로 돌려주므로 이 훅이
 * 직접 한다. 라틴 글자면 `e.key` 를 그대로 쓴다(드보락 · AZERTY 는 자리가 아니라 글자가 맞다).
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

import { readChord } from "@/lib/kbd";
import type { RecentChange } from "@/lib/recentChangesStore";
import { groupKey, visiblePaths, type ChangeBuckets } from "./changeGroups";
import { classifyDiffLines, firstChangedLine, groupIntoHunks, splitLegacyCut } from "./diffParse";

export interface DiffKeyDeps {
  buckets: ChangeBuckets;
  changes: readonly RecentChange[];
  open: ReadonlySet<string>;
  expand: (key: string) => void;
  generated: ReadonlySet<string>;
  generatedOpen: boolean;
  selected: string | null;
  select: (path: string) => void;
  /** 지금 본문의 패치 — 「e」 가 여는 줄과 덩이 수. 바이너리면 null. */
  patch: string | null;
  /** 메모가 달린 파일 — 「⌥n」 이 지금 파일에 메모가 없을 때 건너갈 곳. */
  notedFiles: ReadonlySet<string>;
  toggleViewed: () => void;
  openEditorAt: (line: number | null) => void;
  listRef: RefObject<HTMLDivElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
}

const isTyping = (el: HTMLElement) => el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;

/** 한 글자 키를 라틴 글자로 — 한글 자모처럼 라틴이 아닌 글자는 자리(`KeyJ` → `j`)로 되찾는다. */
export function latinKey(key: string, code: string | undefined): string {
  if (key.length !== 1 || /^[\x20-\x7e]$/.test(key)) return key;
  const m = /^Key([A-Z])$/.exec(code ?? "");
  return m ? m[1].toLowerCase() : key;
}

export function useDiffKeys(d: DiffKeyDeps): (e: KeyboardEvent<HTMLElement>) => void {
  // 덩이 · 메모 자리 — 레이아웃이 없을 때(또는 첫 덩이에서) 이어 갈 곳. 파일을 바꾸면 처음으로.
  const hunkAt = useRef(0);
  const noteAt = useRef(-1);
  useEffect(() => {
    hunkAt.current = 0;
    noteAt.current = -1;
  }, [d.selected]);

  const focusRow = useCallback(
    (path: string) =>
      requestAnimationFrame(() => {
        for (const row of d.listRef.current?.querySelectorAll<HTMLElement>(".chg-item") ?? []) {
          if (row.dataset.path === path) row.focus({ preventScroll: true });
        }
      }),
    [d.listRef],
  );

  return (e) => {
    const target = e.target as HTMLElement;
    if (isTyping(target)) return;
    const chord = readChord(e);
    if (chord.mod) return;
    const key = latinKey(chord.key, e.code);
    if (chord.alt) {
      if (e.code !== "KeyN" && key.toLowerCase() !== "n") return;
      e.preventDefault();
      nextNote();
      return;
    }
    if (e.shiftKey && key !== "[" && key !== "]") return;
    const paths = visiblePaths(d.buckets, d.changes, d.open, d.generated, d.generatedOpen);
    const move = (path: string | undefined) => {
      if (!path) return;
      d.select(path);
      // 포커스도 따라간다 — 안 그러면 이전 줄에 남은 포커스에서 Enter 가 옛 줄을 다시 고른다.
      focusRow(path);
    };
    switch (key) {
      case "j":
      case "k": {
        if (paths.length === 0) return;
        e.preventDefault();
        const cur = d.selected ? paths.indexOf(d.selected) : -1;
        move(paths[key === "j" ? Math.min(cur + 1, paths.length - 1) : Math.max(cur - 1, 0)]);
        return;
      }
      case "[":
      case "]": {
        if (!d.buckets.known) return;
        e.preventDefault();
        jumpGroup(key === "]" ? 1 : -1, move);
        return;
      }
      case "n":
      case "p":
        e.preventDefault();
        jumpHunk(key === "n" ? 1 : -1);
        return;
      case "e":
        if (!d.selected) return;
        e.preventDefault();
        d.openEditorAt(currentLine());
        return;
      case "v":
        if (!d.selected) return;
        e.preventDefault();
        d.toggleViewed();
        return;
    }
  };

  /** 일지 없음(있으면) → 일지 묶음들 차례. 그 묶음을 펼치고 보이는 첫 파일로. */
  function jumpGroup(dir: 1 | -1, move: (path: string | undefined) => void) {
    const keep = (p: string) => !d.generated.has(p);
    const stops: Array<{ key: string | null; files: string[] }> = [];
    const loose = d.buckets.unrecorded.filter(keep);
    if (loose.length > 0) stops.push({ key: null, files: loose });
    for (const g of d.buckets.groups) {
      const files = g.files.filter(keep);
      if (files.length > 0) stops.push({ key: groupKey(g), files });
    }
    if (stops.length === 0) return;
    const cur = d.selected ? stops.findIndex((s) => s.files.includes(d.selected!)) : -1;
    const next = stops[Math.max(0, Math.min(stops.length - 1, cur < 0 ? (dir > 0 ? 0 : stops.length - 1) : cur + dir))];
    if (next.key) d.expand(next.key);
    move(next.files[0]);
  }

  /** 덩이 머리들과, 레이아웃이 있으면 지금 맨 위에 걸친 덩이의 순번(첫 머리 위면 -1). 레이아웃이 없으면 null. */
  function hunkHeads(): { heads: HTMLElement[]; at: number | null } {
    const box = d.bodyRef.current;
    const heads = [...(box?.querySelectorAll<HTMLElement>(".hunk-head") ?? [])];
    if (!box || !heads.some((h) => h.getBoundingClientRect().height > 0)) return { heads, at: null };
    const top = box.getBoundingClientRect().top;
    const below = heads.findIndex((h) => h.getBoundingClientRect().top > top + 2);
    return { heads, at: (below < 0 ? heads.length : below) - 1 };
  }

  /** 다음 · 앞 덩이 머리로 — 레이아웃이 있으면 지금 맨 위에 걸친 덩이를 기준으로. */
  function jumpHunk(dir: 1 | -1) {
    const { heads, at } = hunkHeads();
    if (heads.length === 0) return;
    const next = Math.max(0, Math.min(heads.length - 1, (at ?? hunkAt.current) + dir));
    hunkAt.current = next;
    heads[next].scrollIntoView?.({ block: "start" });
  }

  /**
   * 지금 보이는 덩이의 새 쪽에서 처음 바뀐 줄. 「보이는」 은 레이아웃으로 잰다 — 마우스로 스크롤해 다른
   * 덩이를 보고 있는데 n/p 로 마지막에 옮긴 덩이(화면에 없는 줄)를 열던 것. 레이아웃이 없을 때만 그 자리.
   */
  function currentLine(): number | null {
    if (!d.patch) return null;
    const hunks = groupIntoHunks(classifyDiffLines(splitLegacyCut(d.patch).body)).filter((h) => h.header);
    const { at } = hunkHeads();
    const hunk = hunks[at == null ? hunkAt.current : Math.max(0, at)] ?? hunks[0];
    return hunk ? firstChangedLine(hunk) : null;
  }

  /** 이 파일의 다음 메모로, 없으면 메모가 달린 다음 파일로. */
  function nextNote() {
    const notes = [...(d.bodyRef.current?.querySelectorAll<HTMLElement>(".dl-note") ?? [])];
    if (notes.length > 0) {
      noteAt.current = (noteAt.current + 1) % notes.length;
      notes[noteAt.current].scrollIntoView?.({ block: "center" });
      return;
    }
    const order = d.changes.map((c) => c.path).reverse();
    const from = d.selected ? order.indexOf(d.selected) : -1;
    const rest = [...order.slice(from + 1), ...order.slice(0, from + 1)];
    const hit = rest.find((p) => d.notedFiles.has(p));
    if (hit) {
      d.select(hit);
      focusRow(hit);
    }
  }
}
