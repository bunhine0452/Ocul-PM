import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── 정직성 감사 — dogfooding regression (2026-08-20) ──────────────────────
//
// The card must report a file as 미기록 only when *no* journal entry records
// it. It used to read `only_in_index`, which joins on an exact `session_id`;
// agents stamp their own dialect (`manual-20260820-205400`) that never equals
// the watcher's (`20260820-002`), so every changed file was reported. The
// backend now supplies `unrecorded` (workday coverage) and the card reads that.

type Cmp = {
  session_id: string;
  only_in_index: string[];
  unrecorded: string[];
  unrecorded_severity: string;
  mismatch_severity: string;
};

const fixtures: {
  sessions: Array<{ id: string }>;
  bySession: Record<string, Cmp>;
  /** Sessions whose comparison has actually been delivered to the component. */
  compared: string[];
} = { sessions: [], bySession: {}, compared: [] };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    listSessions: () => Promise.resolve(fixtures.sessions),
    compareLayers: (_pid: number, sid: string) =>
      Promise.resolve(fixtures.bySession[sid]).then((v) => {
        fixtures.compared.push(sid);
        return v;
      }),
  },
}));

import { HonestyAudit } from "@/features/today/HonestyAudit";
import { t } from "@/i18n";

// Query through the dictionary rather than literal copy: the assertions stay
// true if the wording is reworded, and `pnpm lint:i18n` stays happy.
const TITLE = t("today.honesty.title");
const unlogged = (n: number) => t("today.honesty.unlogged", { n });
const WARNING = t("today.honesty.warning");

function cmp(over: Partial<Cmp> = {}): Cmp {
  return {
    session_id: "20260820-002",
    // The session-exact view stays "everything looks missing" — that is the
    // dialect mismatch, and the card must not be fooled by it.
    only_in_index: ["src/a.ts", "src/b.ts", "src/c.ts"],
    unrecorded: [],
    unrecorded_severity: "ok",
    mismatch_severity: "critical",
    ...over,
  };
}

beforeEach(() => {
  fixtures.sessions = [];
  fixtures.bySession = {};
  fixtures.compared = [];
});
afterEach(cleanup);

describe("HonestyAudit", () => {
  it("stays hidden when every changed file is journaled under a foreign session_id", async () => {
    fixtures.sessions = [{ id: "20260820-002" }];
    fixtures.bySession["20260820-002"] = cmp();

    const { container } = render(
      <HonestyAudit projectId={1} workday="20260820" enabled />,
    );

    // Prove the comparison actually arrived before asserting emptiness —
    // otherwise this passes vacuously on the pre-fetch render.
    await waitFor(() => expect(fixtures.compared).toEqual(["20260820-002"]));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("reports only the files no journal entry records", async () => {
    fixtures.sessions = [{ id: "20260820-002" }];
    fixtures.bySession["20260820-002"] = cmp({
      unrecorded: ["landing/shots/01-today.jpg"],
      unrecorded_severity: "warning",
    });

    render(<HonestyAudit projectId={1} workday="20260820" enabled />);

    await screen.findByText(TITLE);
    expect(screen.getByText("landing/shots/01-today.jpg")).toBeTruthy();
    // Count + severity come from the `unrecorded` side, not `only_in_index`.
    expect(screen.getByText(unlogged(1))).toBeTruthy();
    expect(screen.getByText(new RegExp(WARNING))).toBeTruthy();
    // The 3 session-exact "misses" must not leak into the list.
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });

  it("sums unrecorded counts across sessions and skips clean ones", async () => {
    fixtures.sessions = [{ id: "20260820-002" }, { id: "20260820-005" }];
    fixtures.bySession["20260820-002"] = cmp();
    fixtures.bySession["20260820-005"] = cmp({
      session_id: "20260820-005",
      unrecorded: ["a.jpg", "b.jpg"],
      unrecorded_severity: "warning",
    });

    render(<HonestyAudit projectId={1} workday="20260820" enabled />);

    await screen.findByText(TITLE);
    expect(screen.getByText(unlogged(2))).toBeTruthy();
    // The fully-journaled session contributes no row.
    expect(screen.queryByText(/20260820-002/)).toBeNull();
    expect(screen.getByText(/20260820-005/)).toBeTruthy();
  });
});
