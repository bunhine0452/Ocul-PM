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
  /** 감사 자체가 실패한다 (락 경합·파일 없음·전송 계층 실패). */
  fails: boolean;
} = { sessions: [], asked: [], fails: false };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    compareWorkday: (_pid: number, workday: string) => {
      fixtures.asked.push(workday);
      if (fixtures.fails) return Promise.reject(new Error("could not read file_changes.ndjson"));
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
  fixtures.fails = false;
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

  /**
   * {#honesty-catch} — "검사 실패" 와 "깨끗함" 은 다른 것이다.
   *
   * 예전에는 `catch { setRows([]) }` 였다. 감사가 못 돌았는데도 화면은 깨끗한
   * 날과 **글자 하나 다르지 않았다** — 이 제품의 반복 원칙("모르면 모른다고
   * 말한다")과 정면으로 충돌한다.
   */
  it("a failed audit does not hide — it shows the reason and a retry", async () => {
    fixtures.fails = true;
    render(<HonestyAudit projectId={1} workday="20260820" enabled />);

    await screen.findByText(t("today.honesty.failed"));
    expect(screen.getByText(/file_changes.ndjson/)).toBeTruthy();

    // 「다시 시도」 가 실제로 다시 묻는다 — 이번엔 성공한다.
    fixtures.fails = false;
    fixtures.sessions = [row({ unrecorded: ["a.jpg"], unrecorded_severity: "warning" })];
    screen.getByRole("button", { name: t("common.retry") }).click();
    await screen.findByText(TITLE);
    expect(fixtures.asked.length).toBe(2);
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
