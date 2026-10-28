import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// ─── Osaurus 라운드 Phase 6 — 딥링크 확인 시트 (#deep-link) ─────────────────
//
// 이 라운드의 보안 규약은 하나다: **무확인 실행 0.** 백엔드가 URL 을 파싱해
// 이벤트로 넘기고, 실행은 이 시트를 지나야만 일어난다. 그 구조를 잰다.

import { openNavFor, planFor, resolveRegisteredProject } from "@/features/deeplink/deepLinkPlan";
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
  it("열기 링크는 무엇·어디서·무엇이 바뀌는지를 갖는다", () => {
    const plan = planFor({ action: "open", project: "/p", view: null });
    expect(plan.titleKey).toBeTruthy();
    expect(plan.effectKey).toBeTruthy();
    expect(plan.actionKey).toBeTruthy();
    expect(plan.origin).toBe("/p");
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
    emit!({ action: "open", project: "/Users/me/proj", view: null });

    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());
    expect(onAccept).not.toHaveBeenCalled();
    // 출처를 요약하지 않고 그대로 보여 준다.
    expect(r.getByText("/Users/me/proj")).toBeTruthy();
  });

  it("승인해야 실행된다", async () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    emit!({ action: "open", project: "/Users/me/proj", view: "journal" });
    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "열기" }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onAccept.mock.calls[0][0]).toEqual({
      action: "open",
      project: "/Users/me/proj",
      view: "journal",
    });
  });

  it("취소하면 시트가 닫히고 아무 일도 없다", async () => {
    const onAccept = vi.fn();
    const r = render(<DeepLinkSheet onAccept={onAccept} />);
    emit!({ action: "open", project: "/Users/me/proj", view: null });
    await waitFor(() => expect(r.getByRole("dialog")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(r.queryByRole("dialog")).toBeNull());
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe("openNavFor — open 링크의 view 를 WindowNavigate 로", () => {
  const views = ["today", "journal", "planner"] as const;
  it("알려진 화면이면 그 화면, 모르는 view 는 today", () => {
    expect(openNavFor({ view: "planner" }, 1, views)).toEqual({ view: "planner", project_id: 1, entry_path: null });
    expect(openNavFor({ view: "nope" }, 1, views).view).toBe("today");
    expect(openNavFor({ view: null }, 1, views).view).toBe("today");
  });
});

// {#ui-winpath-followups} — 등록 경로와 링크 경로의 **모양**이 OS 마다 다르다. Windows 는
// 구분자·대소문자·`\\?\` 접두가 달라도 같은 폴더, macOS·Linux 는 예전 규칙 그대로(D3).
describe("딥링크 경로 비교 — 세 OS", () => {
  const winProjects = [
    { id: 3, root_path: "C:\\Users\\Me\\Proj" },
    { id: 4, root_path: "\\\\?\\D:\\work\\other" },
    { id: 5, root_path: "\\\\?\\UNC\\server\\share\\team" },
  ];

  it.each([
    ["C:\\Users\\Me\\Proj", 3],
    ["c:\\users\\me\\proj", 3], // 드라이브 글자를 소문자로 주는 쪽도 있다
    ["C:/Users/Me/Proj/", 3],
    ["C:\\Users\\Me\\Proj\\\\", 3],
    ["\\\\?\\C:\\Users\\Me\\Proj", 3],
    ["D:\\Work\\Other", 4],
    ["\\\\server\\share\\team", 5],
    ["C:\\Users\\Me\\Proj2", null],
    ["C:\\Users\\Me", null],
  ] as const)("windows: %s → %s", (wanted, id) => {
    expect(resolveRegisteredProject(winProjects, wanted, "windows")).toBe(id);
  });

  it.each(["mac", "linux"] as const)("%s: 끝의 / 만 무시하고 대소문자·\\ 는 가린다 (예전 그대로)", (os) => {
    const projects = [{ id: 7, root_path: "/Users/me/Proj" }];
    expect(resolveRegisteredProject(projects, "/Users/me/Proj//", os)).toBe(7);
    expect(resolveRegisteredProject(projects, "/users/me/proj", os)).toBeNull();
    expect(resolveRegisteredProject([{ id: 8, root_path: "/a\\b" }], "/a/b", os)).toBeNull();
  });
});
