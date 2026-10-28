/**
 * 창 하나 = 프로젝트 하나 (4.0) — 앱 창이 시작 창과 프로젝트 창 사이를 오가는 배선.
 *
 * 창은 마운트 때 백엔드에 자기 프로젝트를 묻고(`get_window_project`), 이후는
 * `WindowProjectChanged` 를 따라간다 — 시작 창이 프로젝트를 고르면 **같은 창**이
 * 그 프로젝트가 되고, 그 프로젝트를 지우면 같은 창이 시작 창으로 돌아온다.
 * 다른 창 앞으로 온 이벤트는 듣지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  seed: null as number | null,
  listeners: [] as Array<(p: { window: string; project_id: number | null }) => void>,
  close: vi.fn(async () => null),
  newWindow: vi.fn(async () => null),
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    projectOf: async () => fx.seed,
    onProjectChanged: (cb: (p: { window: string; project_id: number | null }) => void) => {
      fx.listeners.push(cb);
      return Promise.resolve(() => {});
    },
    closeThisWindow: fx.close,
    newWindow: fx.newWindow,
  },
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: async () => [{ id: 7, name: "naeri", root_path: "/x/naeri", created_at: 1, icon: null, color: null, theme_id: null }],
  },
}));
vi.mock("@/features/start/StartWindow", () => ({ StartWindow: () => <div data-testid="surface">start</div> }));
vi.mock("@/windows/ProjectWindow", () => ({
  default: ({ projectId }: { projectId: number }) => <div data-testid="surface">{`project:${projectId}`}</div>,
}));
vi.mock("@/components/BootSplash", () => ({ BootSplash: () => null }));
vi.mock("@/components/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("@/components/EmbeddingModelBanner", () => ({ EmbeddingModelBanner: () => null }));

import AppWindow from "@/windows/AppWindow";
import { useWindowKeys } from "@/hooks/useWindowKeys";
import { __setPlatformForTests } from "@/lib/platform";

const surface = () => screen.getByTestId("surface").textContent;
const emit = (window: string, project_id: number | null) =>
  act(() => fx.listeners.forEach((cb) => cb({ window, project_id })));

beforeEach(() => {
  fx.seed = null;
  fx.listeners.length = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("앱 창 — 시작 창 ↔ 프로젝트 창", () => {
  it("프로젝트가 없는 창은 시작 창이고, 고르면 같은 창이 그 프로젝트가 된다", async () => {
    render(<AppWindow windowLabel="main" />);
    expect(await screen.findByText("start")).toBeInTheDocument();
    emit("main", 7);
    expect(surface()).toBe("project:7");
    // 창 제목 = 프로젝트 이름 (창 전환기에서 구분된다).
    await vi.waitFor(() => expect(document.title).toBe("naeri"));
  });

  it("다른 창 앞으로 온 이벤트는 듣지 않는다", async () => {
    render(<AppWindow windowLabel="win-2" />);
    await screen.findByText("start");
    emit("main", 7);
    expect(surface()).toBe("start");
  });

  it("업데이트 복원처럼 이미 프로젝트가 실린 창은 바로 프로젝트 창으로 선다", async () => {
    fx.seed = 7;
    render(<AppWindow windowLabel="main" />);
    expect(await screen.findByText("project:7")).toBeInTheDocument();
  });

  it("그 프로젝트를 지우면 같은 창이 시작 창으로 돌아온다", async () => {
    fx.seed = 7;
    render(<AppWindow windowLabel="win-3" />);
    await screen.findByText("project:7");
    emit("win-3", null);
    expect(surface()).toBe("start");
  });
});

describe("창 키 — ⌘W 창 닫기 · ⇧⌘N 새 창", () => {
  it("mac 은 앱 메뉴가 받는다 — 키다운으로 두 번 받지 않는다", () => {
    __setPlatformForTests("mac");
    const onClose = vi.fn();
    const onNewWindow = vi.fn();
    renderHook(() => useWindowKeys({ onClose, onNewWindow }));
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    fireEvent.keyDown(window, { key: "N", code: "KeyN", metaKey: true, shiftKey: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(onNewWindow).not.toHaveBeenCalled();
  });

  it.each(["windows", "linux"] as const)("%s: Ctrl+W 는 창을 닫고 Ctrl+Shift+N 은 새 시작 창", (os) => {
    __setPlatformForTests(os);
    const onClose = vi.fn();
    const onNewWindow = vi.fn();
    renderHook(() => useWindowKeys({ onClose, onNewWindow }));
    fireEvent.keyDown(window, { key: "w", code: "KeyW", ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
    expect(onNewWindow).toHaveBeenCalledTimes(1);
    // ⇧ 가 붙은 W 는 창 닫기가 아니다.
    fireEvent.keyDown(window, { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
