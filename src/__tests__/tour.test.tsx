// 처음 쓰는 법 (ocul-next #tour-modal · #tour-reopen) — 네 쪽, 처음 한 번 저절로, 다시 열기.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const ctx = vi.hoisted(() => ({
  value: {
    settings: { tourSeen: "" },
    loaded: true,
    set: vi.fn(async (_f: string, _v: string) => {}),
  } as { settings: { tourSeen: string }; loaded: boolean; set: ReturnType<typeof vi.fn> } | null,
}));
vi.mock("@/contexts/SettingsContext", () => ({ useOptionalSettings: () => ctx.value }));

import { TourHost } from "@/features/tour/TourHost";
import { t } from "@/i18n";
import { requestTour } from "@/lib/projectActions";

const dialog = () => screen.queryByRole("dialog", { name: t("tour.title") });

beforeEach(() => {
  ctx.value = { settings: { tourSeen: "" }, loaded: true, set: vi.fn(async () => {}) };
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("처음 쓰는 법", () => {
  it("처음엔 저절로 뜨고 그때 바로 「봤음」을 적는다 — 네 쪽을 넘겨 「시작하기」로 닫는다", () => {
    render(<TourHost />);
    expect(dialog()).not.toBeNull();
    expect(ctx.value?.set).toHaveBeenCalledWith("tourSeen", "1");
    expect(screen.getByText(t("tour.p1.title"))).toBeInTheDocument();
    expect(screen.getByText(t("tour.page", { n: 1, total: 4 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("tour.next") }));
    expect(screen.getByText(t("tour.p2.title"))).toBeInTheDocument();
    // 다섯 화면이 단축키와 함께.
    for (const key of ["⌘1", "⌘5"]) expect(screen.getByText(key)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("tour.prev") }));
    expect(screen.getByText(t("tour.p1.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("tour.next") }));
    fireEvent.click(screen.getByRole("button", { name: t("tour.next") }));
    expect(screen.getByText(t("tour.p3.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("tour.next") }));
    expect(screen.queryByRole("button", { name: t("tour.skip") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("tour.done") }));
    expect(dialog()).toBeNull();
  });

  it("이미 봤거나 이 창이 앞에 없으면 저절로 뜨지 않는다 — 앞에 오면 그때 뜬다", () => {
    ctx.value = { settings: { tourSeen: "1" }, loaded: true, set: vi.fn(async () => {}) };
    const { unmount } = render(<TourHost />);
    expect(dialog()).toBeNull();
    unmount();

    ctx.value = { settings: { tourSeen: "" }, loaded: true, set: vi.fn(async () => {}) };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    render(<TourHost />);
    expect(dialog()).toBeNull();
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(dialog()).not.toBeNull();
  });

  it("건너뛰기로 닫고, ⌘K 「처음 쓰는 법」으로 첫 쪽부터 다시 연다", () => {
    render(<TourHost />);
    fireEvent.click(screen.getByRole("button", { name: t("tour.next") }));
    fireEvent.click(screen.getByRole("button", { name: t("tour.skip") }));
    expect(dialog()).toBeNull();
    act(() => requestTour());
    expect(dialog()).not.toBeNull();
    expect(screen.getByText(t("tour.p1.title"))).toBeInTheDocument();
  });

  it("← → 로 쪽을 넘긴다", () => {
    render(<TourHost />);
    const d = dialog()!;
    fireEvent.keyDown(d, { key: "ArrowRight" });
    expect(screen.getByText(t("tour.p2.title"))).toBeInTheDocument();
    fireEvent.keyDown(d, { key: "ArrowLeft" });
    expect(screen.getByText(t("tour.p1.title"))).toBeInTheDocument();
  });
});
