// 오늘 — 색과 기계 글씨 (11-15 TD-05, DESIGN.md 「영수증」 규칙 1 · 2 · 4).
//
// 예외가 아닌 곳의 색(도는 세션의 초록 점 · 본문보다 밝은 강조색 링크 · 빈 상태의 강조색 체크)을 걷고, 시각 ·
// 확인 명령 · 경로를 고정폭으로, 같은 「검증」 상태를 일지 화면과 한 모양(`EvidenceMark`)으로 맞췄다.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EvidenceMark } from "@/features/oculpm/JournalRow";
import { TodayWork } from "@/features/today/TodayWork";
import * as model from "@/features/today/todayModel";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import { digest, entry } from "./todayFixture";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const css = read("features", "today", "today.css");
const verdictCss = read("components", "verdictLine.css");
/** 주석을 뺀 규칙 — 왜 그 값을 버렸는지는 주석으로 남을 수 있어야 한다. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

afterEach(cleanup);

describe("colour only for exceptions", () => {
  it("today.css uses neither the pass green nor the accent text colour", () => {
    expect(rules).not.toMatch(/var\(--ok\b/);
    expect(rules).not.toMatch(/var\(--accent-text\)/);
    expect(rules).not.toMatch(/var\(--accent\)/);
  });

  it("a running session's dot is grey; only a quiet one is amber", () => {
    expect(rules).toMatch(/\.tdy-sess-dot \{[^}]*background: var\(--text-2\)/);
    expect(rules).toMatch(/\.tdy-sess-dot\.is-quiet \{[^}]*background: var\(--warn\)/);
  });

  it("links are the app's one text link (body ink, faint underline); group heads are transparent until hovered", () => {
    expect(rules).not.toMatch(/\.tdy-link\b/);
    expect(read("styles", "screens-overflow.css")).toMatch(/\.text-link \{[^}]*color: var\(--text\)[^}]*text-decoration: underline/);
    expect(rules).toMatch(/\.tdy-grp \{[^}]*background: transparent/);
  });
});

describe("machine text is mono", () => {
  it("times are mono with tabular figures — today's rows and the verdict line alike", () => {
    expect(rules).toMatch(/\.tdy-time \{[^}]*font-family: var\(--mono\)[^}]*font-variant-numeric: tabular-nums/);
    expect(verdictCss).toMatch(/\.vl-when \{[^}]*font-family: var\(--mono\)[^}]*font-variant-numeric: tabular-nums/);
    expect(rules).toMatch(/\.tdy-cnt \{[^}]*tabular-nums/);
    expect(rules).toMatch(/\.tdy-day b \{[^}]*tabular-nums/);
  });

  it("the card's horizontal padding is one local variable", () => {
    expect(rules).toContain("--card-pad-x: 14px;");
    expect(rules.match(/\b14px\b/g)).toHaveLength(1);
  });
});

describe("same meaning, same shape", () => {
  it("'done today' rows mark verification with the journal list's EvidenceMark", () => {
    const entries = [entry(1, { type: "bug", evidence: 0 }), entry(2, { evidence: 2 }), entry(3, { type: "chore", evidence: 0 })];
    const { container } = render(createElement(TodayWork, { entries, digest: digest(), onOpenEntry: () => {} }));
    const marks = [...container.querySelectorAll(".tdy-ent-ev")].map((el) => el.firstElementChild?.className ?? "");
    const journal = (state: "missing" | "command") => render(createElement(EvidenceMark, { state })).container.firstElementChild?.className;
    expect(marks).toEqual([journal("missing"), journal("command"), ""]);
  });

  it("dictionary values carry no ✓ · ! decoration, and no today value starts with a mark", () => {
    for (const dict of [ko, en] as Array<Record<string, string>>) {
      const today = Object.entries(dict).filter(([k]) => k.startsWith("today."));
      expect(today.filter(([, v]) => /^[✓✗!]/.test(v.trim())).map(([k]) => k)).toEqual([]);
      const labels = today.filter(([k]) => k.startsWith("today.work.") || k.startsWith("today.chip.") || k.startsWith("today.check.kind."));
      expect(labels.filter(([, v]) => /[✓✗!]/.test(v)).map(([k]) => k)).toEqual([]);
    }
  });

  it("todayModel no longer keeps its own copy of the verification rule", () => {
    expect("evidenceOf" in model).toBe(false);
    expect("EVIDENCE_COMMAND" in model).toBe(false);
  });

  it("drops the branches nothing used", () => {
    expect(rules).not.toContain("b.tdy-warn");
    expect(Object.keys(ko)).not.toContain("today.check.userShare");
  });
});
