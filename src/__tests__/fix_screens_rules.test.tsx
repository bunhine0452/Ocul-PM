// 최종 검수 고침 (11-15 fix-screens) — 화면 넷이 같이 쓰는 규칙: 한 낱말 한 뜻 · 한 동작 한 이름 · 영수증 규칙 2(기계
// 글씨만 mono) · 글자 링크 한 벌 · 눌린 단추 한 벌 · 목록 칸의 면 끝 · 문서 시작선. 파일과 사전을 읽어 무는 계약과,
// 그리기 없이 도는 조각(`machineParts` · `RadioSeg`)의 단위 시험이다. 화면을 그려 무는 것은 `fix_screens_*` 다른 파일.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MachineText, machineParts, machinePlain, splitParts } from "@/components/MachineText";
import { RadioSeg } from "@/components/RadioSeg";
import { StaleNote } from "@/components/StaleNote";
import { VerdictLine } from "@/components/VerdictLine";
import { LiveCard } from "@/features/today/TodaySide";
import { NoteSlot } from "@/features/diff/DiffNotes";
import { setLangSetting, t } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import { ROOT, read, walk } from "./designFs";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, " ");
/** 선택자가 정확히 `sel` 인 규칙의 본문(주석 뺀 것). 없으면 `null`. */
function rule(file: string, sel: string): string | null {
  const m = [...strip(read(file)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((x) => x[1].trim() === sel);
  return m ? m[2] : null;
}

afterEach(() => {
  cleanup();
  setLangSetting("ko");
});

describe("RC-03 — the crash card points at the settings section that exists", () => {
  function Boom(): never {
    throw new Error("render exploded");
  }

  it.each(["ko", "en"] as const)("%s: the hint names the section and the row by their own keys", (lang) => {
    setLangSetting(lang);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary label="test">
        <Boom />
      </ErrorBoundary>,
    );
    quiet.mockRestore();
    const hint = container.querySelector(".err-hint")?.textContent ?? "";
    expect(hint).toContain(` → ${t("prefs.data.title")} → ${t("prefs.data.logs")}`);
    // 칸 이름은 사전 값에 박혀 있지 않다 — 다음 개명에도 따라온다.
    const dict = (lang === "ko" ? ko : en) as Record<string, string>;
    expect(dict["crash.body"]).toContain("{section}");
    expect(dict["crash.body"]).toContain("{logs}");
    expect(hint).not.toContain("{section}");
  });
});

describe("RC-07 — one word, one meaning: a note that took effect is not called 'changed'", () => {
  it.each(["ko", "en"] as const)("%s: the diff note states never reuse Today's amber 'changed' chip", (lang) => {
    setLangSetting(lang);
    const todayChanged = t("today.check.kind.stale");
    expect(t("diff.notes.fixed")).not.toBe(todayChanged);
    expect(t("diff.notes.open")).not.toBe(todayChanged);
    expect(t("diff.notes.progress", { fixed: 1, n: 2 })).not.toContain(todayChanged);
  });

  it("a sent note whose line moved shows the grey 'taken effect' chip with its own word", () => {
    const anchor = { file: "src/a.ts", side: "new" as const, line: 3, code: "const longEnough = 1;" };
    const { container } = render(<NoteSlot projectId={1} anchor={anchor} note={{ ...anchor, text: "rename", sent: true, fixed: true }} editing={false} />);
    const chip = container.querySelector(".dl-note .chip")!;
    expect(chip.className).toContain("ok");
    expect(chip.textContent).toBe(t("diff.notes.fixed"));
    expect(chip.textContent).not.toBe(t("today.check.kind.stale"));
  });
});

describe("RC-09 — one action, one name, one voice: asking Claude for a journal entry", () => {
  it.each(["ko", "en"] as const)("%s: Today, the terminal band and the diff banner use the same verb", (lang) => {
    setLangSetting(lang);
    expect(t("terminal.askRecord")).toBe(t("today.check.askJournal"));
    expect(t("diff.unrecorded.ask")).toBe(t("today.check.askJournal"));
  });

  it("every prompt the app hands Claude ends its sentences in the polite form (no plain speech)", () => {
    const yo = String.fromCodePoint(0xc694); // 해요체의 끝 글자 — 사전 밖에 한글 글자를 두지 않는다(lint:i18n).
    const prompts = Object.entries(ko as Record<string, string>).filter(
      ([k]) => (k.startsWith("today.") && /Prompt$/.test(k)) || k === "terminal.askRecordPrompt" || k === "diff.unrecorded.prompt",
    );
    expect(prompts.map(([k]) => k)).toEqual(expect.arrayContaining(["today.check.askJournalPrompt", "terminal.askRecordPrompt", "diff.unrecorded.prompt"]));
    for (const [key, value] of prompts) {
      // 한글로 끝나는 문장의 마지막 글자 — 해요체면 늘 「요」 다.
      const enders = [...value.matchAll(/(\p{Script=Hangul})\.(?=\s|$)/gu)].map((m) => m[1]);
      expect(enders.length, key).toBeGreaterThan(0);
      expect(enders.every((c) => c === yo), `${key}: ${value}`).toBe(true);
    }
  });
});

describe("RC-06 — times are machine text everywhere, the planner's included", () => {
  it(".plv-time is mono with tabular figures and no ligatures, like the verdict line and the journal list", () => {
    const plv = rule("features/planner/planner.css", ".plv-time") ?? "";
    expect(plv).toMatch(/font-family:\s*var\(--mono\)/);
    expect(plv).toMatch(/font-variant-ligatures:\s*none/);
    expect(plv).toMatch(/tabular-nums/);
    for (const [file, sel] of [
      ["components/verdictLine.css", ".vl-when"],
      ["features/oculpm/journal.css", ".jl-when"],
    ] as const) {
      expect(rule(file, sel), sel).toMatch(/font-family:\s*var\(--mono\)/);
    }
  });
});

describe("RC-21 — one text link", () => {
  it("the one rule is an always-on faint underline; Today and the journal keep no link rules of their own", () => {
    const link = rule("styles/screens-overflow.css", ".text-link") ?? "";
    expect(link).toMatch(/color:\s*var\(--text\)/);
    expect(link).toMatch(/text-decoration:\s*underline/);
    expect(link).toMatch(/text-decoration-color:\s*var\(--sep-strong\)/);
    expect(strip(read("features/today/today.css"))).not.toMatch(/\.tdy-link\b/);
    expect(strip(read("features/oculpm/journal.css"))).not.toMatch(/\.jd-link\b/);
    // 화면이 쓰는 링크는 전부 그 한 벌이다.
    for (const file of ["features/today/TodaySide.tsx", "features/oculpm/JournalRelated.tsx", "features/oculpm/JournalDetail.tsx", "components/StaleNote.tsx"]) {
      expect(read(file), file).toContain('className="text-link');
    }
    const stray = [...walk(ROOT)].filter((f) => f.endsWith(".tsx") && /className="[^"]*\b(tdy-link|jd-link)\b/.test(read(f.slice(ROOT.length + 1))));
    expect(stray).toEqual([]);
  });

  it("Today's 'show in terminal' and the reread note's retry render as that link", () => {
    const { container } = render(
      <>
        <LiveCard
          sessions={[{ id: "s", agentId: "claude-code", startedAt: 0, lastRecordAt: 0, conversations: 1 } as never]}
          now={3 * 60 * 60_000}
          term={{ id: 7 } as never}
          onShowTerminal={vi.fn()}
        />
        <StaleNote since={Date.now()} onRetry={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: t("today.check.openTerminal") }).className).toBe("text-link");
    expect(screen.getByRole("button", { name: t("common.retry") }).className).toBe("text-link");
    expect(container.querySelector(".tdy-link, .jd-link")).toBeNull();
  });
});

describe("RC-19 — one pressed-button rule", () => {
  it("a pressed .btn is one rule (face + rule colour, same weight); the journal and the diff keep no copies", () => {
    const pressed = rule("styles/screens-overflow.css", '.btn[aria-pressed="true"]') ?? "";
    expect(pressed).toMatch(/background:\s*var\(--bg-active\)/);
    expect(pressed).toMatch(/border-color:\s*var\(--sep-strong\)/);
    expect(pressed).not.toMatch(/font-weight/);
    expect(strip(read("features/oculpm/journal.css"))).not.toMatch(/\.(jd-read|btn)\[aria-pressed/);
    expect(strip(read("features/diff/changes.css"))).not.toMatch(/\.btn\[aria-pressed/);
  });

  it("RadioSeg can block a choice: it keeps focus and says why, arrows skip it, a click does nothing", () => {
    const onChange = vi.fn();
    render(
      <RadioSeg
        label="period"
        value="all"
        options={[
          { id: "recent", label: "Recent", blockedReason: "locked while filtering" },
          { id: "all", label: "All" },
          { id: "old", label: "Old" },
        ]}
        onChange={onChange}
      />,
    );
    const recent = screen.getByRole("radio", { name: "Recent" });
    expect(recent).toHaveAttribute("aria-disabled", "true");
    expect(recent).toHaveAttribute("title", "locked while filtering");
    fireEvent.click(recent);
    expect(onChange).not.toHaveBeenCalled();
    // all → → old → → (recent 은 건너뛴다) all.
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("old");
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("old");
    expect(onChange).not.toHaveBeenCalledWith("recent");
  });
});

describe("V-03 — the three list panes reserve no scrollbar gutter", () => {
  it.each([
    ["features/oculpm/journal.css", ".jl-list"],
    ["features/diff/changes.css", ".chg-list"],
    ["features/planner/planner.css", ".plv-rail"],
  ])("%s %s", (file, sel) => {
    expect(rule(file, `${sel}::-webkit-scrollbar`)).toMatch(/width:\s*0/);
    expect(strip(read(file))).not.toMatch(/scrollbar-gutter/);
  });
});

describe("V-11 — the diff document starts on the same 24px line as the journal and the plan", () => {
  it("file head and banner use --space-8 like .jd and .plv-main", () => {
    expect(rule("features/diff/changes.css", ".chg-fh")).toMatch(/padding:\s*var\(--space-3\) var\(--space-8\)/);
    expect(rule("features/diff/changes.css", ".chg-banner")).toMatch(/margin:\s*var\(--space-5\) var\(--space-8\) 0/);
    expect(rule("features/oculpm/journal.css", ".jd")).toMatch(/padding:\s*var\(--space-8\)/);
    expect(rule("features/planner/planner.css", ".plv-main")).toMatch(/padding:\s*var\(--space-8\) var\(--space-8\)/);
  });
});

describe("V-10 — Today's 'next' title may run to three lines", () => {
  it("clamps at 3 (was 2 — the wide window hid the end of the title)", () => {
    expect(rule("features/today/today.css", ".tdy-next .tdy-row-title")).toMatch(/-webkit-line-clamp:\s*3/);
  });
});

describe("X-OK-GREEN — the dead green .btn.ok rule is gone", () => {
  it("no stylesheet colours a button with the pass green", () => {
    const hits = [...walk(ROOT)]
      .filter((f) => f.endsWith(".css"))
      .filter((f) => /\.btn\.ok\b/.test(strip(read(f.slice(ROOT.length + 1)))));
    expect(hits).toEqual([]);
  });
});

describe("V-08 — inside a human line only the machine text is mono", () => {
  const mono = (line: string) => machineParts(line).filter((p) => p.mono).map((p) => p.text);

  it("backticks, a command at the head of a piece, and result tokens are machine text; the sentence is not", () => {
    // i18n-ignore-next-line -- 검증 줄 표본(에이전트가 쓴 한국어)이 검사 재료다
    const line = "합류 뒤: `pnpm test` 1652 passed · `cargo test` 1202 passed 0 failed. 설치본에서 눈으로 보지는 않았다.";
    expect(mono(line)).toEqual(["pnpm test 1652 passed · cargo test 1202 passed 0 failed"]);
    expect(machinePlain(line)).toBe(line.replace(/`/g, ""));
    // i18n-ignore-next-line -- 문장 가운데의 명령 이름은 사람 말이다
    expect(mono("실제 cargo 시험으로 확인했다")).toEqual([]);
    expect(mono("vitest 116 files passed · typecheck · lint · build exit 0.")).toEqual(["vitest 116 files passed", "exit 0"]);
    expect(mono("$ cargo test --locked")).toEqual(["$ cargo test --locked"]);
    expect(machineParts("a `b c")).toEqual([{ text: "a `b c", mono: false }]);
    expect(machineParts("**bold** `x`")).toEqual([
      { text: "bold ", mono: false },
      { text: "x", mono: true },
    ]);
    expect(mono("2 failed, 418 passed")).toEqual(["2 failed, 418 passed"]);
  });

  it("uses no regex lookbehind — older WebKitGTK cannot parse it and the whole chunk would fail to load", () => {
    expect(read("components/MachineText.tsx")).not.toMatch(/\(\?<[=!]/);
  });

  it("splitParts cuts on the plain text and keeps each piece's kind", () => {
    const [head, tail] = splitParts(machineParts("pnpm test 3 passed · eyes not checked"), 18);
    expect(head.map((p) => p.text).join("")).toBe("pnpm test 3 passed");
    expect(tail).toEqual([{ text: " · eyes not checked", mono: false }]);
  });

  it("the verdict line draws the summary in body type with mono only around the command and its count", () => {
    // i18n-ignore-next-line -- 판정 끝 줄 표본(에이전트가 덧붙인 한국어)이 검사 재료다
    const summary = "pnpm test 1117 passed · 설치본 눈 확인은 안 함 · mac";
    const { container } = render(<VerdictLine state="pass" summary={summary} />);
    const out = container.querySelector(".vl-out")!;
    expect([...out.querySelectorAll(".mono")].map((m) => m.textContent)).toEqual(["pnpm test 1117 passed"]);
    expect(out.textContent).toContain(summary);
    expect(rule("components/verdictLine.css", ".vl-out")).toMatch(/font-family:\s*var\(--font\)/);
    expect(rule("components/verdictLine.css", ".vl-out .mono")).toMatch(/font-family:\s*var\(--mono\)/);
    // 검증 상자 · 바닥줄도 상자는 본문 서체, 안의 기계 글씨만 mono.
    expect(rule("features/oculpm/journal.css", ".jd-term")).not.toMatch(/font-family/);
    expect(rule("features/oculpm/journal.css", ".jd-term .mono")).toMatch(/font-family:\s*var\(--mono\)/);
    expect(rule("features/diff/changes.css", ".def-line .mono")).toMatch(/font-family:\s*var\(--mono\)/);
    render(<MachineText text="`x`" />);
  });
});
