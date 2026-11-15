// 오늘 — 열면 이미 서 있다 (11-15 TD-02).
//
// 셸(배지)과 화면이 프로젝트별 모듈 저장소 하나를 같이 구독한다. 예전엔 화면이 마운트마다 빈 인스턴스를
// 새로 만들어 탭에 올 때마다 뼈대가 섰고, 사건 하나에 같은 읽기가 두세 번 돌았고, 다시 읽기가 한 번
// 실패하면 멀쩡한 값까지 버리고 오류 카드가 섰다. 응답 순서를 안 봐 답한 질문이 다시 설 수 있었다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { __resetTodayStoreForTests, useTodayExceptions } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { WORKDAY, emit, entry, fx, release, resetFx, sleep } from "./todayFixture";
import { renderToday } from "./todayRender";

const unreadRows = () => within(screen.getByRole("region", { name: t("today.unread.title") })).queryAllByRole("listitem");

/** 셸의 배지 자리 — 같은 프로젝트의 둘째 인스턴스. */
function Badge() {
  const { count } = useTodayExceptions(1, WORKDAY, true);
  return <output data-testid="badge">{count ?? "-"}</output>;
}

/** 이 사건 뒤에 다시 읽기가 끝날 때까지 — 250ms 병합 + 다음 틱 접기 + 응답. */
const settle = () => act(() => sleep(400));

beforeEach(() => {
  resetFx();
  fx.entries = [entry(1, { type: "bug", evidence: 0, title: "first" }), entry(2, { type: "bug", evidence: 0, title: "second" })];
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("the store outlives the screen", () => {
  it("draws the last rows on the first render after a remount — no skeleton", async () => {
    const first = renderToday();
    await waitFor(() => expect(unreadRows()).toHaveLength(2));
    first.unmount();
    const again = renderToday();
    // 첫 그림 — 아무것도 기다리지 않은 채로.
    expect(again.container.querySelector(".skel")).toBeNull();
    expect(unreadRows().map((r) => r.getAttribute("aria-label"))).toEqual(["first", "second"]);
  });

  it("shows the skeleton only the first time a project is read", async () => {
    fx.hold.add("todayDigest");
    const { container } = renderToday();
    expect(container.querySelector(".skel")).not.toBeNull();
    await waitFor(() => expect(fx.held.todayDigest).toHaveLength(1));
    release("todayDigest");
    await waitFor(() => expect(container.querySelector(".skel")).toBeNull());
  });

  it("keeps one frame width before and after the data arrives", async () => {
    fx.hold.add("oculpmWorkdayBrief");
    const { container } = renderToday();
    const before = (container.querySelector(".tdy-body") as HTMLElement).className;
    await waitFor(() => expect(fx.held.oculpmWorkdayBrief).toHaveLength(1));
    release("oculpmWorkdayBrief");
    await waitFor(() => expect(unreadRows()).toHaveLength(2));
    expect((container.querySelector(".tdy-body") as HTMLElement).className).toBe(before);
    expect(container.querySelector(".tdy-side")).not.toBeNull();
  });
});

describe("one read per event, however many instances", () => {
  it("reads the plan digest once for the screen and the badge together, and once per plan event", async () => {
    renderToday(<Badge />);
    await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("0"));
    await settle();
    expect(fx.calls.todayDigest).toBe(1);
    act(() => emit("oculpmDataChanged", { project_id: 1, area: "planner" }));
    await settle();
    expect(fx.calls.todayDigest).toBe(2);
  });

  it("throttles window focus: five focus events inside ten seconds read 'only on this machine' once, the next after ten seconds again", async () => {
    // 시계만 쥔다(타이머는 진짜) — 스로틀은 Date.now 로 잰다.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      renderToday();
      await waitFor(() => expect(unreadRows()).toHaveLength(2));
      await settle();
      const before = fx.calls.todayLocalOnly ?? 0;
      // 사이마다 틱을 둔다 — 같은 틱의 요청은 저장소가 한 번으로 접어서, 스로틀이 없어도 한 번으로 보였다.
      for (let i = 0; i < 5; i++) {
        act(() => void window.dispatchEvent(new Event("focus")));
        await act(() => sleep(20));
        vi.setSystemTime(Date.now() + 1_000);
      }
      await settle();
      expect((fx.calls.todayLocalOnly ?? 0) - before).toBe(1);
      vi.setSystemTime(Date.now() + 10_000);
      act(() => void window.dispatchEvent(new Event("focus")));
      await settle();
      expect((fx.calls.todayLocalOnly ?? 0) - before).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a failed re-read keeps what was read", () => {
  it("keeps the rows and says since when it could not read — no error card", async () => {
    renderToday();
    await waitFor(() => expect(unreadRows()).toHaveLength(2));
    fx.fail.add("oculpmWorkdayBrief");
    act(() => emit("oculpmJournalUpdated", { project_id: 1 }));
    await waitFor(() => expect(document.querySelector(".stale-note")).not.toBeNull());
    expect(unreadRows()).toHaveLength(2);
    expect(screen.queryByText(t("today.loadFailed"))).toBeNull();
    // 「다시 시도」 가 다시 읽고, 읽히면 그 줄은 사라진다.
    fx.fail.delete("oculpmWorkdayBrief");
    fireEvent.click(within(document.querySelector(".stale-note") as HTMLElement).getByRole("button", { name: t("common.retry") }));
    await waitFor(() => expect(document.querySelector(".stale-note")).toBeNull());
  });

  it("shows the error card only when nothing was ever read", async () => {
    fx.fail.add("oculpmWorkdayBrief");
    renderToday();
    expect(await screen.findByText(t("today.loadFailed"))).toBeInTheDocument();
  });
});

describe("late answers do not overwrite newer ones", () => {
  it("drops an old questions reply that lands after the newer one — an answered question does not come back", async () => {
    fx.questions = [{ id: "q1", question: "ship?", options: [], asked_at: new Date().toISOString() }];
    fx.hold.add("claudeQuestions");
    renderToday();
    await waitFor(() => expect(fx.held.claudeQuestions).toHaveLength(1));
    // 그 사이 답해서 질문이 사라졌다 — 새 읽기는 빈 목록으로 먼저 답한다.
    fx.questions = [];
    act(() => emit("claudeQuestionsChanged", { project_id: 1 }));
    await waitFor(() => expect(fx.calls.claudeQuestions).toBe(2));
    await settle();
    release("claudeQuestions");
    await settle();
    expect(screen.queryByText("ship?")).toBeNull();
  });
});
