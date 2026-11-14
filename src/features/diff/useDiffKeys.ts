/**
 * 변경 화면의 키 (11-15 #diff-keys) — 화면 루트가 듣는다(입력칸 안은 빼고). 치트시트(⌘/)의 DIFF
 * 묶음(`shortcutRegistry`)이 이 표를 그대로 옮겨 적는다: 알린 키 = 듣는 키. 예전 표는 화면에 없는
 * 키 셋(/ · n/N · f)을 알렸고 화면은 j/k 만 들었다.
 *
 *   j / k   파일        [ / ]   일지 묶음       n / p   파일 안 덩이
 *   ⌥n      다음 메모   e       편집기에서 그 줄  v       봤음
 *
 * 한 글자 판정은 `readChord(e).key` 로 — 두벌식 자판의 글자는 그쪽이 라틴 글자로 되돌린다.
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
    const key = chord.key;
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

  /** 다음 · 앞 덩이 머리로 — 레이아웃이 있으면 지금 맨 위에 걸친 덩이를 기준으로. */
  function jumpHunk(dir: 1 | -1) {
    const box = d.bodyRef.current;
    const heads = [...(box?.querySelectorAll<HTMLElement>(".hunk-head") ?? [])];
    if (!box || heads.length === 0) return;
    const top = box.getBoundingClientRect().top;
    let next: number;
    if (heads.some((h) => h.getBoundingClientRect().height > 0)) {
      const below = heads.findIndex((h) => h.getBoundingClientRect().top > top + 2);
      const at = (below < 0 ? heads.length : below) - 1;
      next = at + dir;
    } else {
      next = hunkAt.current + dir;
    }
    next = Math.max(0, Math.min(heads.length - 1, next));
    hunkAt.current = next;
    heads[next].scrollIntoView?.({ block: "start" });
  }

  /** 지금 덩이(n/p 로 옮긴 곳, 아니면 첫 덩이)의 새 쪽에서 처음 바뀐 줄. */
  function currentLine(): number | null {
    if (!d.patch) return null;
    const hunks = groupIntoHunks(classifyDiffLines(splitLegacyCut(d.patch).body)).filter((h) => h.header);
    const hunk = hunks[hunkAt.current] ?? hunks[0];
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
