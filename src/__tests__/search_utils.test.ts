import { describe, it, expect } from "vitest";
import { trimAroundMatch, markMatchesInHtml, splitMatch } from "@/features/search/searchUtils";

// Code-search upgrade round (2026-08-16) — pure helpers behind the exact-match
// result cards: window trimming around the first hit, <mark> injection into
// hljs HTML (text nodes only), and plain-text match splitting for symbol names.

describe("trimAroundMatch", () => {
  const lines = (n: number, hitAt?: number) =>
    Array.from({ length: n }, (_, i) => (i === hitAt ? `const target = ${i};` : `line ${i}`)).join(
      "\n",
    );

  it("returns short content untouched", () => {
    const content = lines(7, 3);
    const r = trimAroundMatch(content, "target", 5);
    expect(r.text).toBe(content);
    expect(r.truncated).toBe(false);
    expect(r.matchLine).toBe(3);
    expect(r.totalLines).toBe(7);
  });

  it("windows a long chunk around the first match (±context)", () => {
    const r = trimAroundMatch(lines(40, 20), "target", 5);
    expect(r.truncated).toBe(true);
    expect(r.fromLine).toBe(15);
    expect(r.toLine).toBe(25);
    expect(r.matchLine).toBe(20);
    expect(r.text.split("\n")).toHaveLength(11);
    expect(r.text).toContain("const target = 20;");
  });

  it("slides the window up when the match is near the end", () => {
    const r = trimAroundMatch(lines(30, 29), "target", 5);
    expect(r.fromLine).toBe(19);
    expect(r.toLine).toBe(29);
    expect(r.text).toContain("const target = 29;");
  });

  it("falls back to the head when nothing matches (formatting drift)", () => {
    const r = trimAroundMatch(lines(40), "nomatch-xyz", 5);
    expect(r.matchLine).toBeNull();
    expect(r.fromLine).toBe(0);
    expect(r.toLine).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it("matches case-insensitively", () => {
    const r = trimAroundMatch(lines(40, 12), "TARGET", 5);
    expect(r.matchLine).toBe(12);
  });
});

describe("markMatchesInHtml", () => {
  it("wraps matches inside text nodes with <mark class=\"s-hit\">", () => {
    const html = `<span class="hljs-keyword">const</span> useFoo = 1;`;
    const out = markMatchesInHtml(html, "useFoo");
    expect(out).toContain(`<mark class="s-hit">useFoo</mark>`);
    // The hljs span structure survives untouched.
    expect(out).toContain(`<span class="hljs-keyword">const</span>`);
  });

  it("marks multiple occurrences and is case-insensitive", () => {
    const out = markMatchesInHtml("foo bar Foo", "foo");
    const marks = out.match(/<mark/g) ?? [];
    expect(marks).toHaveLength(2);
    // Original casing is preserved inside the mark.
    expect(out).toContain(`<mark class="s-hit">Foo</mark>`);
  });

  it("never matches inside tag names or attributes", () => {
    const html = `<span class="hljs-string">"span"</span>`;
    const out = markMatchesInHtml(html, "span");
    // The attribute/tag spelling of "span" is untouched; only the text node hits.
    expect(out).toContain(`<span class="hljs-string">`);
    expect(out).toContain(`<mark class="s-hit">span</mark>`);
  });

  it("returns input unchanged for an empty query", () => {
    const html = `<span>abc</span>`;
    expect(markMatchesInHtml(html, "  ")).toBe(html);
  });
});

describe("splitMatch", () => {
  it("splits around case-insensitive hits", () => {
    expect(splitMatch("useTodayMonitor", "today")).toEqual([
      { text: "use", hit: false },
      { text: "Today", hit: true },
      { text: "Monitor", hit: false },
    ]);
  });

  it("no match → single non-hit segment", () => {
    expect(splitMatch("abc", "zz")).toEqual([{ text: "abc", hit: false }]);
  });

  it("empty query → single non-hit segment", () => {
    expect(splitMatch("abc", "")).toEqual([{ text: "abc", hit: false }]);
  });
});
