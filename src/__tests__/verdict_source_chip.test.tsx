// 판정의 출처를 한 칩으로 (11-23 love-round L8 #verdict-honesty-badge).
//
// 같은 「검증 없음」 이라도 검증 칸을 아예 안 쓴 것(0)과, 썼지만 돌린 명령 · 결과 끝 줄이 없는 것(1 — 에이전트의 말뿐)은
// 다르다. 일지 목록 행 · 오늘 한 일 · 상세가 같은 호박 칩에 상세 검증 상자와 같은 말 「명령 없음」 을 싣고, ✓ 는 누가
// 세웠는지(명령 결과 · 사람이 읽음)를 이름에 싣는다. 새 색 · 새 칩 모양은 없다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { EvidenceMark, JournalRow } from "@/features/oculpm/JournalRow";
import { setLangSetting, t } from "@/i18n";
import { entry } from "./journalHarness";

beforeEach(() => setLangSetting("en"));
afterEach(cleanup);

describe("evidence mark says who stands behind the verdict", () => {
  it("names a written-but-unrun verification as the agent's word, in the same warn chip", () => {
    const { container } = render(<EvidenceMark state="missing" level={1} />);
    const chip = container.querySelector(".chip.sm.warn")!;
    expect(chip.textContent).toBe(t("journal.verify.noCommand"));
    expect(chip.getAttribute("title")).toBe(t("journal.evidence.wordsTitle"));
  });

  it("keeps 「No verification」 when nothing was written", () => {
    const { container } = render(<EvidenceMark state="missing" level={0} />);
    const chip = container.querySelector(".chip.sm.warn")!;
    expect(chip.textContent).toBe(t("journal.evidence.missing"));
    expect(chip.hasAttribute("title")).toBe(false);
  });

  it("tells a command-backed ✓ from a human read ✓ by name, without colour", () => {
    const cmd = render(<EvidenceMark state="command" level={2} />).container.querySelector(".jl-ok")!;
    expect(cmd.getAttribute("aria-label")).toBe(t("entry.evidence.command"));
    expect(cmd.getAttribute("title")).toBe(t("journal.evidence.commandTitle"));
    cleanup();
    const read = render(<EvidenceMark state="confirmed" level={1} />).container.querySelector(".jl-ok")!;
    expect(read.getAttribute("aria-label")).toBe(t("entry.verified"));
    expect(read.querySelector(".warn")).toBeNull();
  });

  it("puts the source on the journal list row", () => {
    const words = render(
      <JournalRow entry={entry({ type: "bug", evidence: 1 })} selected={false} onSelect={vi.fn()} />,
    ).container;
    expect(words.querySelector(".chip.warn")?.textContent).toBe(t("journal.verify.noCommand"));
    cleanup();
    const none = render(
      <JournalRow entry={entry({ type: "bug", evidence: 0 })} selected={false} onSelect={vi.fn()} />,
    ).container;
    expect(none.querySelector(".chip.warn")?.textContent).toBe(t("journal.evidence.missing"));
  });
});
