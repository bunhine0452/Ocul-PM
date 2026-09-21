import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── journal-scale-round {#hotspot-card} ────────────────────────────────────
//
// 같은 파일에 bug/error 일지가 몰린 "재발" 신호. HonestyAudit
// ({#honesty-audit-unhide}) / JournalMissingCard ({#card-unhide})와 같은
// 규율을 따른다 — 0건이라고 카드가 사라지면 "안 봤다"와 "봤는데 재발이
// 없다"가 화면에서 구별되지 않는다.

type Hotspot = {
  file_path: string;
  bug_count: number;
  error_count: number;
  total_entries: number;
  last_workday: string;
  last_entry_path: string;
  last_entry_title: string;
};

const fixtures: {
  hotspots: Hotspot[];
  /** 컴포넌트가 실제로 물은 (projectId, days, limit). */
  asked: Array<[number, number | null, number | null]>;
} = { hotspots: [], asked: [] };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    fileHotspots: (projectId: number, days: number | null, limit: number | null) => {
      fixtures.asked.push([projectId, days, limit]);
      return Promise.resolve(fixtures.hotspots);
    },
  },
}));

import { HotspotCard } from "@/features/today/HotspotCard";
import { t } from "@/i18n";

// 문구를 사전을 통해 묻는다 — 문구가 바뀌어도 이 테스트는 그대로 참이고,
// `pnpm lint:i18n` 과 충돌하지 않는다.
const TITLE = t("today.hotspot.title");

function hotspot(over: Partial<Hotspot> = {}): Hotspot {
  return {
    file_path: "src-tauri/src/oculpm/watcher.rs",
    bug_count: 5,
    error_count: 1,
    total_entries: 6,
    last_workday: "20260904",
    last_entry_path: "20260904/Bugs/0900_bug_watcher.md",
    last_entry_title: "watcher fix",
    ...over,
  };
}

beforeEach(() => {
  fixtures.hotspots = [];
  fixtures.asked = [];
});
afterEach(cleanup);

describe("HotspotCard", () => {
  /**
   * {#hotspot-card-unhide} — 0건이어도 카드는 남는다: 제목·범위(90일)와 빈
   * 상태 문구를 보여주고, 설명 줄(재발이 있을 때만 뜨는 문구)은 뜨지 않는다.
   */
  it("renders and does not hide when there are no recurring files", async () => {
    render(<HotspotCard projectId={1} enabled onOpenEntry={() => {}} />);

    await waitFor(() => expect(fixtures.asked).toEqual([[1, 90, 5]]));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText(t("today.hotspot.zeroNote"))).toBeTruthy();
    expect(screen.queryByText(t("today.hotspot.desc"))).toBeNull();
  });

  /** 재발 파일이 있으면 행을 그리고, 클릭이 그 파일의 마지막 일지를 연다. */
  it("renders a recurring file row and opens its last entry on click", async () => {
    fixtures.hotspots = [hotspot()];
    const onOpenEntry = vi.fn();

    render(<HotspotCard projectId={1} enabled onOpenEntry={onOpenEntry} />);

    await screen.findByText(TITLE);
    expect(screen.getByText(t("today.hotspot.desc"))).toBeTruthy();
    const row = screen.getByRole("button", { name: /watcher\.rs/ });
    row.click();
    expect(onOpenEntry).toHaveBeenCalledWith("20260904/Bugs/0900_bug_watcher.md");
  });
});
