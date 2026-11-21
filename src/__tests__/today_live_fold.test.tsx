// 오늘 「지금 일하는 중」 — 세션이 많아도 볼 것만 줄로 선다 (11-22).
//
// 세션마다 한 줄이라 40개가 도는 날 40줄이 섰고, 30분 넘게 조용한 세션(볼 것)이 그 사이에 흩어져 묻혔다. 잘 돌고
// 있는 세션은 예외가 아니다 — 조용한 것만 줄로 서고 나머지는 접힌 한 줄이 수로 말한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";

import { LIVE_LIMIT, LiveCard } from "@/features/today/TodaySide";
import type { LiveSession } from "@/features/today/useLiveSessions";
import { t } from "@/i18n";

afterEach(cleanup);

const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;
const MIN = 60_000;
const NOW = 10 * 60 * MIN;

/** `quietMin` 분 전에 마지막으로 기록한 세션. */
function live(i: number, quietMin: number): LiveSession {
  return { id: `s${i}`, agentId: "claude-code", conversations: 1, lastRecordAt: NOW - quietMin * MIN, startedAt: 0 };
}

const rows = (el: HTMLElement) => el.querySelectorAll(".tdy-sess");

describe("Working now — 40 sessions", () => {
  it("shows only the quiet sessions as rows and folds the rest into one line — 40 rows become 4", () => {
    // 37개는 방금 기록했고 셋만 30분 넘게 조용하다 — 그 셋이 목록 한가운데 흩어져 있다.
    const sessions = Array.from({ length: 40 }, (_, i) => live(i, i === 9 ? 95 : i === 21 ? 41 : i === 33 ? 200 : 3));
    const { container } = render(<LiveCard sessions={sessions} now={NOW} term={null} onShowTerminal={vi.fn()} />);
    const card = screen.getByRole("region", { name: t("today.live.title") });
    // 머리의 수는 전부를 센다.
    expect(card.querySelector(".tdy-cnt")?.textContent).toBe("40");
    // 조용한 셋 — 가장 오래 조용한 것부터.
    expect(rows(container)).toHaveLength(3); // 예전엔 40
    expect([...rows(container)].map((r) => r.querySelector(".tdy-warn")?.textContent)).toEqual([
      t("today.live.quietHours", { n: 3 }),
      t("today.live.quietHours", { n: 1 }),
      t("today.live.quiet", { n: 41 }),
    ]);
    // 나머지는 접힌 한 줄 — 수로 말하고, 누르면 그 자리에서 펴진다.
    const fold = within(card).getByRole("button", { name: `${t("today.live.rest")} 37` });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    expect(rows(container)).toHaveLength(40);
    fireEvent.click(fold);
    expect(rows(container)).toHaveLength(3);
  });

  it("says none is quiet in a single line when nothing needs a look", async () => {
    const sessions = Array.from({ length: 40 }, (_, i) => live(i, i % 20));
    const { container } = render(<LiveCard sessions={sessions} now={NOW} term={null} onShowTerminal={vi.fn()} />);
    expect(rows(container)).toHaveLength(0);
    const fold = screen.getByRole("button", { name: `${t("today.live.noneQuiet", { n: 30 })} 40` });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".tdy-warn")).toBeNull();
    expect((await axe(container, AXE_OPTIONS)).violations).toEqual([]);
  });

  it("caps quiet rows at the limit and the folded line counts the quiet ones it hides", () => {
    const sessions = Array.from({ length: 40 }, (_, i) => live(i, i < 12 ? 60 + i : 2));
    const { container } = render(<LiveCard sessions={sessions} now={NOW} term={null} onShowTerminal={vi.fn()} />);
    expect(rows(container)).toHaveLength(LIVE_LIMIT);
    const hiddenQuiet = 12 - LIVE_LIMIT;
    const fold = screen.getByRole("button", {
      name: `${t("today.live.rest")} · ${t("today.live.restQuiet", { m: hiddenQuiet })} ${40 - LIVE_LIMIT}`,
    });
    // 접힌 조용한 세션이 있다는 것은 색으로도 선다 — 접혀서 예외가 사라지면 안 된다.
    expect(fold.querySelector(".tdy-warn")).not.toBeNull();
    fireEvent.click(fold);
    expect(rows(container)).toHaveLength(40);
  });

  it("shows every session when there are few — quiet ones just come first", () => {
    const sessions = [live(1, 2), live(2, 45), live(3, 5)];
    const { container } = render(<LiveCard sessions={sessions} now={NOW} term={null} onShowTerminal={vi.fn()} />);
    expect(rows(container)).toHaveLength(3);
    expect(rows(container)[0].querySelector(".tdy-warn")?.textContent).toBe(t("today.live.quiet", { n: 45 }));
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
  });

  it("keeps Show in terminal on a quiet row when the card folds", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => live(i, i === 4 ? 90 : 1));
    const onShow = vi.fn();
    render(<LiveCard sessions={sessions} now={NOW} term={{ id: 7 } as never} onShowTerminal={onShow} />);
    fireEvent.click(screen.getByRole("button", { name: t("today.check.openTerminal") }));
    expect(onShow).toHaveBeenCalledWith(7);
  });
});
