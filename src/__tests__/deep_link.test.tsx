import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// ─── Osaurus 라운드 Phase 6 — 딥링크 확인 시트 (#deep-link) ─────────────────
//
// 이 라운드의 보안 규약은 하나다: **무확인 실행 0.** 백엔드가 URL 을 파싱해
// 이벤트로 넘기고, 실행은 이 시트를 지나야만 일어난다. 그 구조를 잰다.

import { openNavFor, planFor, resolveRegisteredProject } from "@/features/deeplink/deepLinkPlan";
import {
  consumeThemeInstall,
  onThemeInstallRequest,
  requestThemeInstall,
  resetThemeInstallIntent,
} from "@/features/theme/themeInstallIntent";
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
    expect(r.getByText(/지금까지 바뀐 것은 없어요/)).toBeTruthy();
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

// ─── Phase 8 (#landing-themes) — 승인 뒤에 실제로 가져온다 ─────────────────
//
// 시트는 「테마 파일을 받아 갤러리에 추가해요」라고 말한다. 승인해도 설정
// 화면만 열리고 아무것도 받아오지 않으면 그 문장이 거짓이 된다. 갤러리가
// 아직 없어도 요청이 사라지지 않는 것까지 잰다 (끈적 플래그).
describe("themeInstallIntent", () => {
  afterEach(() => resetThemeInstallIntent());

  it("갤러리가 마운트되기 전에 온 요청은 마운트 때 회수된다", () => {
    requestThemeInstall("https://oculpm.com/themes/ink.json");
    expect(consumeThemeInstall()).toBe("https://oculpm.com/themes/ink.json");
    // 소비형이다 — 두 번 열지 않는다.
    expect(consumeThemeInstall()).toBeNull();
  });

  it("이미 떠 있는 갤러리는 구독으로 즉시 받는다", () => {
    const seen: string[] = [];
    const off = onThemeInstallRequest((url) => seen.push(url));
    requestThemeInstall("https://oculpm.com/themes/ember.json");
    off();
    requestThemeInstall("https://oculpm.com/themes/ink.json");
    expect(seen).toEqual(["https://oculpm.com/themes/ember.json"]);
    // 구독이 처리했으면 마운트 회수가 같은 것을 또 열지 않는다.
    resetThemeInstallIntent();
    expect(consumeThemeInstall()).toBeNull();
  });
});

describe("openNavFor — open 링크의 view/entry 를 TrayNavigate 로", () => {
  const views = ["today", "journal", "planner"] as const;
  it("프로젝트 안의 규격 일지 절대경로만 상대경로로 받고 journal 로 간다", () => {
    const nav = openNavFor(
      { project: "/Users/me/proj/", view: null, entry: "/Users/me/proj/.oculpm/journal/20260911/Chores/1403_chore_x.md" },
      7,
      views,
    );
    expect(nav).toEqual({ view: "journal", project_id: 7, entry_path: "20260911/Chores/1403_chore_x.md" });
  });
  it("다른 프로젝트·탈출·규격 밖 entry 는 버리고 view 만 — 모르는 view 는 today", () => {
    expect(openNavFor({ project: "/p", view: "planner", entry: "/q/.oculpm/journal/20260911/Chores/1_chore_x.md" }, 1, views).entry_path).toBeNull();
    expect(openNavFor({ project: "/p", view: "planner", entry: "/p/.oculpm/journal/../../x.md" }, 1, views)).toEqual({ view: "planner", project_id: 1, entry_path: null });
    expect(openNavFor({ project: "/p", view: "nope", entry: null }, 1, views).view).toBe("today");
    expect(openNavFor({ project: "/p", view: null, entry: null }, 1, views).view).toBe("today");
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
    ["c:\\users\\me\\proj", 3], // VS Code 는 드라이브 글자를 소문자로 준다
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

  it("windows: 일지 절대경로가 역슬래시·다른 대소문자여도 journal 로, 상대경로는 / · 원문 대소문자", () => {
    const views = ["today", "journal"] as const;
    const nav = openNavFor(
      {
        project: "c:\\users\\me\\proj",
        view: null,
        entry: "C:\\Users\\Me\\Proj\\.oculpm\\journal\\20260911\\Chores\\1403_chore_x.md",
      },
      3,
      views,
      "windows",
    );
    expect(nav).toEqual({ view: "journal", project_id: 3, entry_path: "20260911/Chores/1403_chore_x.md" });
    // 다른 프로젝트 · 탈출은 여전히 버린다.
    expect(
      openNavFor(
        { project: "C:\\p", view: "today", entry: "C:\\q\\.oculpm\\journal\\20260911\\Chores\\1_chore_x.md" },
        1,
        views,
        "windows",
      ).entry_path,
    ).toBeNull();
    expect(
      openNavFor(
        { project: "C:\\p", view: "today", entry: "C:\\p\\.oculpm\\journal\\..\\..\\x.md" },
        1,
        views,
        "windows",
      ).entry_path,
    ).toBeNull();
  });

  it.each(["mac", "linux"] as const)("%s: 역슬래시 일지 경로는 받지 않는다 (예전 그대로)", (os) => {
    const nav = openNavFor(
      { project: "/p", view: null, entry: "/p\\.oculpm\\journal\\20260911\\Chores\\1403_chore_x.md" },
      1,
      ["today", "journal"],
      os,
    );
    expect(nav.entry_path).toBeNull();
  });
});
