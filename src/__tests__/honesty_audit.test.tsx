import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── 정직성 감사 — dogfooding regression (2026-08-20) ──────────────────────
//
// The card must report a file as 미기록 only when *no* journal entry records
// it. It used to read `only_in_index`, which joins on an exact `session_id`;
// agents stamp their own dialect (`manual-20260820-205400`) that never equals
// the watcher's (`20260820-002`), so every changed file was reported. The
// backend supplies `unrecorded` (workday coverage) and the card reads that.
//
// 완성도 라운드 Phase 3 (2026-08-30): the card asks for the whole workday in
// one call (`compareWorkday`) instead of listing sessions and comparing each.

type SessionRow = {
  session_id: string;
  unrecorded: string[];
  unrecorded_severity: string;
};

const fixtures: {
  sessions: SessionRow[];
  /** Workdays the component actually asked for. */
  asked: string[];
} = { sessions: [], asked: [] };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    compareWorkday: (_pid: number, workday: string) => {
      fixtures.asked.push(workday);
      return Promise.resolve({
        workday,
        sessions: fixtures.sessions,
        unrecorded_total: fixtures.sessions.reduce((n, s) => n + s.unrecorded.length, 0),
      });
    },
  },
}));

import { HonestyAudit } from "@/features/today/HonestyAudit";
import { t } from "@/i18n";

// Query through the dictionary rather than literal copy: the assertions stay
// true if the wording is reworded, and `pnpm lint:i18n` stays happy.
const TITLE = t("today.honesty.title");
const unlogged = (n: number) => t("today.honesty.unlogged", { n });
const WARNING = t("today.honesty.warning");

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: "20260820-002",
    unrecorded: [],
    unrecorded_severity: "ok",
    ...over,
  };
}

beforeEach(() => {
  fixtures.sessions = [];
  fixtures.asked = [];
});
afterEach(cleanup);

describe("HonestyAudit", () => {
  it("stays hidden when every changed file is journaled under a foreign session_id", async () => {
    fixtures.sessions = [row()];

    const { container } = render(
      <HonestyAudit projectId={1} workday="20260820" enabled />,
    );

    // Prove the comparison actually arrived before asserting emptiness —
    // otherwise this passes vacuously on the pre-fetch render.
    await waitFor(() => expect(fixtures.asked).toEqual(["20260820"]));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("reports only the files no journal entry records", async () => {
    fixtures.sessions = [
      row({ unrecorded: ["landing/shots/01-today.jpg"], unrecorded_severity: "warning" }),
    ];

    render(<HonestyAudit projectId={1} workday="20260820" enabled />);

    await screen.findByText(TITLE);
    expect(screen.getByText("landing/shots/01-today.jpg")).toBeTruthy();
    expect(screen.getByText(unlogged(1))).toBeTruthy();
    expect(screen.getByText(new RegExp(WARNING))).toBeTruthy();
  });

  it("sums unrecorded counts across sessions and skips clean ones", async () => {
    fixtures.sessions = [
      row(),
      row({ session_id: "20260820-005", unrecorded: ["a.jpg", "b.jpg"], unrecorded_severity: "warning" }),
    ];

    render(<HonestyAudit projectId={1} workday="20260820" enabled />);

    await screen.findByText(TITLE);
    expect(screen.getByText(unlogged(2))).toBeTruthy();
    // The fully-journaled session contributes no row.
    expect(screen.queryByText(/20260820-002/)).toBeNull();
    expect(screen.getByText(/20260820-005/)).toBeTruthy();
  });
});
