import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// ─── Osaurus 라운드 Phase 6 — 딥링크 확인 시트 (#deep-link) ─────────────────
//
// 이 라운드의 보안 규약은 하나다: **무확인 실행 0.** 백엔드가 URL 을 파싱해
// 이벤트로 넘기고, 실행은 이 시트를 지나야만 일어난다. 그 구조를 잰다.

import { planFor, resolveRegisteredProject } from "@/features/deeplink/deepLinkPlan";
import type { DeepLink } from "@/lib/bindings";

let emit: ((payload: DeepLink) => void) | null = null;

vi.mock("@/api/deeplink", () => ({
  onDeepLink: (cb: (link: DeepLink) => void) => {
    emit = cb;
    return () => {};
  },
}));

import { DeepLinkSheet } from "@/features/deeplink/DeepLinkSheet";

afterEach(() => {
  cleanup();
  emit = null;
});

describe("deepLinkPlan (순수 함수)", () => {
  it("네 경로 전부 무엇·어디서·무엇이 바뀌는지를 갖는다", () => {
    const links: DeepLink[] = [
      { action: "plugin_install", source: "o/r" },
      { action: "skill_install", source: "o/r", name: "run-evals" },
      { action: "theme_install", url: "https://oculpm.com/t.json" },
      { action: "open", project: "/p", view: null, entry: null },
    ];
    for (const link of links) {
      const plan = planFor(link);
      expect(plan.titleKey).toBeTruthy();
      expect(plan.effectKey).toBeTruthy();
      expect(plan.actionKey).toBeTruthy();
      expect(plan.origin.length).toBeGreaterThan(0);
    }
  });

  it("여는 것은 쓰기가 아니고, 설치는 쓰기다", () => {
    expect(planFor({ action: "open", project: "/p", view: null, entry: null }).writes).toBe(false);
    expect(planFor({ action: "plugin_install", source: "o/r" }).writes).toBe(true);
  });

  it("등록되지 않은 프로젝트는 열지 않는다 — 링크가 프로젝트를 추가하지 못한다", () => {
    const projects = [{ id: 7, root_path: "/Users/me/proj" }];
    expect(resolveRegisteredProject(projects, "/Users/me/proj")).toBe(7);
    expect(resolveRegisteredProject(projects, "/Users/me/proj/")).toBe(7);
    expect(resolveRegisteredProject(projects, "/Users/me/other")).toBeNull();
    expect(resolveRegisteredProject([], "/Users/me/proj")).toBeNull();
  });
});

describe("DeepLinkSheet", () => {
  it("링크가 오기 전에는 아무것도 그리지 않는다", () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    expect(r.container.textContent).toBe("");
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("링크가 와도 승인 전에는 실행하지 않는다", async () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    emit!({ action: "plugin_install", source: "owner/repo" });

    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());
    expect(onAccept).not.toHaveBeenCalled();
    // 출처를 요약하지 않고 그대로 보여 준다.
    expect(r.getByText("github.com/owner/repo")).toBeTruthy();
    expect(r.getByText(/지금까지 바뀐 것은 없습니다/)).toBeTruthy();
  });

  it("승인해야 실행된다", async () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    emit!({ action: "plugin_install", source: "owner/repo" });
    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "미리보기" }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onAccept.mock.calls[0][0]).toEqual({
      action: "plugin_install",
      source: "owner/repo",
    });
  });

  it("취소하면 시트가 닫히고 아무 일도 없다", async () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    emit!({ action: "theme_install", url: "https://oculpm.com/t.json" });
    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(r.queryByRole("dialog")).toBeNull());
    expect(onAccept).not.toHaveBeenCalled();
  });
});
