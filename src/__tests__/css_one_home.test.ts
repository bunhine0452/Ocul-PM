// 한 물체는 규칙 한 곳 (11-15 합류 G-01 · G-08). 레인마다 제 파일만 고치느라 남긴 사본이 정본을 덮거나 정본과
// 갈라졌다.
//
//  - 세그먼트의 고른 칸 — 탭(aria-selected) · 라디오 묶음(aria-checked) · 눌린 단추(aria-pressed)가 primitives.css 의
//    한 선택자로 선다. 옛 면(--bg-card + --shadow-card)을 옮겨 적은 사본이 남은 화면(설정 · 변경 · 오늘 · 일지 종류)은
//    다크에서 고른 칸이 트랙보다 어두운 「빈 구멍」 이었다.
//  - 변경 화면 바닥줄 — changes.css 가 정본이다. screens-overflow.css 의 옛 사본이 index.css 를 거쳐 **뒤에** 실려
//    (ShellV2 가 변경 화면 다음에 index.css 를 들인다) 좁은 창의 꺾임 간격(padding · row-gap)과 선 색을 덮었다.
//
// CSS 는 jsdom 이 var() 를 풀지 못해 계산 값으로 물 수 없다 — 파일을 읽어 선택자를 문다. 실제 계산 값(padding)은
// 하네스 diff 「후」 에서 본다.
import { describe, expect, it } from "vitest";

import { ROOT, read, walk } from "./designFs";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rel = (file: string) => file.slice(ROOT.length + 1);
/** 파일마다 선택자 하나씩(쉼표로 가른 것) — @media 안의 규칙도 같은 꼴로 나온다. */
function selectors(file: string): string[] {
  return [...strip(read(file)).matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
}
const sheets = () => [...walk(ROOT)].filter((f) => f.endsWith(".css")).map(rel);

const PICKED = '.seg-item:is([aria-selected="true"], [aria-checked="true"], [aria-pressed="true"])';

describe("segment — the picked cell has one rule (G-01)", () => {
  it("primitives.css picks by all three state attributes in one rule, painted with --seg-on", () => {
    const blocks = [...strip(read("styles/primitives.css")).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const rule = blocks.find((m) => m[1].trim() === PICKED);
    expect(rule, PICKED).toBeTruthy();
    expect(rule![2]).toMatch(/background:\s*var\(--seg-on\)/);
    expect(rule![2]).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--sep-strong\)/);
  });

  it("no other stylesheet re-declares a picked segment cell (screens.css · today.css · journal.css had copies)", () => {
    const copies = sheets()
      .filter((f) => f !== "styles/primitives.css")
      .flatMap((f) => selectors(f).filter((s) => /\.seg-item\S*\[aria-(selected|checked|pressed)="true"\]/.test(s)).map((s) => `${f}: ${s}`));
    expect(copies).toEqual([]);
  });
});

describe("diff footer — changes.css is its only home (G-08)", () => {
  // 바닥줄 자신의 상자 — `.diff-entry-foot`(속성 갈래 포함)와 `.def-*`. 안쪽 단추를 고르는 후손 선택자는 상자가 아니다.
  const OWN = /^\.(diff-entry-foot|def-[a-z]+)(\[[^\]]+\])*(\s*>\s*svg)?$/;

  it("changes.css declares the footer with its wrap gaps", () => {
    const own = selectors("features/diff/changes.css").filter((s) => OWN.test(s));
    expect(own).toEqual(expect.arrayContaining([".diff-entry-foot", ".def-label", ".def-line"]));
    const foot = [...strip(read("features/diff/changes.css")).matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === ".diff-entry-foot");
    expect(foot![2]).toMatch(/padding:\s*var\(--space-1\) var\(--space-4\)/);
    expect(foot![2]).toMatch(/gap:\s*var\(--space-1\) var\(--space-3\)/);
  });

  it("no other stylesheet declares the footer's own boxes (screens-overflow.css had the old ones)", () => {
    const copies = sheets()
      .filter((f) => f !== "features/diff/changes.css")
      .flatMap((f) => selectors(f).filter((s) => OWN.test(s)).map((s) => `${f}: ${s}`));
    expect(copies).toEqual([]);
  });
});
