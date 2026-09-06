import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WelcomeWizard } from "@/features/onboarding/WelcomeWizard";
import { shouldOpenWelcome } from "@/features/onboarding/welcomeGate";
import { KEYS } from "@/lib/settings";
import type { Project } from "@/lib/bindings";
import { ko } from "@/i18n/ko";

// 첫 실행 마법사 (2026-09-01).
//
// 이 파일이 지키는 계약 셋:
//  1. **이미 쓰던 사용자를 건드리지 않는다** — `onboarded` 는 이번에 생긴 키라
//     기존 설치본에서 전부 false 다. 프로젝트가 하나라도 있으면 뜨지 않는다.
//  2. **어느 출구로 나가도 `onboarded` 를 적는다** — 끝내기·건너뛰기·Esc.
//     한 번 본 창이 다시 뜨면 그건 버그로 읽힌다.
//  3. **고른 언어는 AI 작성 언어까지 맞춘다** — 첫 실행에는 아직 일지가 없어
//     섞일 이력이 없다. 설정 화면의 "따라가지 않는다" 규칙과 갈리는 지점이라
//     회귀하면 조용히 UI 만 바뀐다.

const settingsEntries = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));
const setCalls = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok(settingsEntries.current);
          if (prop === "settingsSet")
            return (key: string, value: string) => {
              setCalls.current.push([key, value]);
              return ok(null);
            };
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));

const project: Project = {
  id: 7,
  name: "ai-pm",
  root_path: "/Users/me/ai-pm",
} as unknown as Project;

interface Handlers {
  onPickFolder?: () => Promise<Project | null>;
  onStartGreenfield?: () => void;
  onOpenProject?: (p: Project) => void;
  onClose?: () => void;
}

function renderWizard(h: Handlers = {}) {
  const handlers = {
    onPickFolder: h.onPickFolder ?? (() => Promise.resolve(null)),
    onStartGreenfield: h.onStartGreenfield ?? vi.fn(),
    onOpenProject: h.onOpenProject ?? vi.fn(),
    onClose: h.onClose ?? vi.fn(),
  };
  render(
    <SettingsProvider>
      <WelcomeWizard {...handlers} />
    </SettingsProvider>,
  );
  return handlers;
}

const wrote = (key: string) => setCalls.current.filter(([k]) => k === key).map(([, v]) => v);

beforeEach(() => {
  settingsEntries.current = [];
  setCalls.current = [];
});

afterEach(cleanup);

describe("shouldOpenWelcome — 누구에게 뜨는가", () => {
  const base = {
    active: true,
    settingsLoaded: true,
    projectsLoaded: true,
    onboarded: false,
    projectCount: 0,
  };

  it("처음 켠 사람에게 뜬다", () => {
    expect(shouldOpenWelcome(base)).toBe(true);
  });

  it("프로젝트가 하나라도 있으면 뜨지 않는다 (기존 사용자 보호)", () => {
    expect(shouldOpenWelcome({ ...base, projectCount: 1 })).toBe(false);
  });

  it("한 번 끝냈으면 다시 뜨지 않는다", () => {
    expect(shouldOpenWelcome({ ...base, onboarded: true })).toBe(false);
  });

  it("설정·목록을 읽기 전에는 판정하지 않는다", () => {
    expect(shouldOpenWelcome({ ...base, settingsLoaded: false })).toBe(false);
    expect(shouldOpenWelcome({ ...base, projectsLoaded: false })).toBe(false);
  });

  it("배경 탭에서는 뜨지 않는다", () => {
    expect(shouldOpenWelcome({ ...base, active: false })).toBe(false);
  });
});

describe("WelcomeWizard — 세 판을 지나 프로젝트까지", () => {
  it("언어를 고르면 화면 언어와 AI 작성 언어를 함께 적는다", async () => {
    renderWizard();
    await screen.findByText(ko["welcome.lang.title"]);

    fireEvent.click(screen.getByRole("radio", { name: ko["settings.language.en"] }));

    await waitFor(() => expect(wrote(KEYS.language)).toEqual(["en"]));
    expect(wrote(KEYS.contentLanguage)).toEqual(["en"]);
  });

  it("모양 판에서 테마와 강조색이 즉시 적용된다", async () => {
    renderWizard();
    await screen.findByText(ko["welcome.lang.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));

    await screen.findByText(ko["welcome.look.title"]);
    fireEvent.click(screen.getByRole("radio", { name: ko["welcome.look.dark"] }));
    fireEvent.click(screen.getByRole("radio", { name: ko["settings.accent.blue"] }));

    await waitFor(() => expect(wrote(KEYS.theme)).toEqual(["dark"]));
    expect(wrote(KEYS.colorTheme)).toEqual(["blue"]);
  });

  it("폴더를 고르면 마무리 판이 서고, 열면 그 프로젝트가 열린다", async () => {
    const onOpenProject = vi.fn();
    const onClose = vi.fn();
    renderWizard({
      onPickFolder: () => Promise.resolve(project),
      onOpenProject,
      onClose,
    });

    await screen.findByText(ko["welcome.lang.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));
    await screen.findByText(ko["welcome.look.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));

    await screen.findByText(ko["welcome.project.title"]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ko["welcome.project.open"]) }));

    // 마무리 판은 방금 들여온 프로젝트의 이름을 말한다.
    await screen.findByText(/ai-pm/);
    // …그리고 아직 심지 않은 것을 심었다고 말하지 않는다 (v3-surface
    // {#wizard-tense}) — 목록은 "열면 이렇게 된다" 로 걸려 있어야 한다.
    expect(screen.getByText(ko["welcome.ready.listLabel"])).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ko["welcome.ready.open"] }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(project));
    expect(onClose).toHaveBeenCalled();
    expect(wrote(KEYS.onboarded)).toEqual(["true"]);
  });

  it("폴더 선택을 취소하면 판이 그대로다", async () => {
    renderWizard({ onPickFolder: () => Promise.resolve(null) });
    await screen.findByText(ko["welcome.lang.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));
    await screen.findByText(ko["welcome.look.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));

    await screen.findByText(ko["welcome.project.title"]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ko["welcome.project.open"]) }));

    await waitFor(() =>
      expect(screen.getByText(ko["welcome.project.title"])).toBeInTheDocument(),
    );
    expect(wrote(KEYS.onboarded)).toEqual([]);
  });

  it("건너뛰어도 onboarded 를 적는다 — 다시 뜨지 않게", async () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    await screen.findByText(ko["welcome.lang.title"]);

    fireEvent.click(screen.getByRole("button", { name: ko["welcome.skip"] }));

    await waitFor(() => expect(wrote(KEYS.onboarded)).toEqual(["true"]));
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc 도 같은 출구다", async () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    const title = await screen.findByText(ko["welcome.lang.title"]);

    fireEvent.keyDown(title, { key: "Escape" });

    await waitFor(() => expect(wrote(KEYS.onboarded)).toEqual(["true"]));
    expect(onClose).toHaveBeenCalled();
  });

  it("새 프로젝트로 넘어가면 마법사를 닫고 그린필드를 연다", async () => {
    const onStartGreenfield = vi.fn();
    const onClose = vi.fn();
    renderWizard({ onStartGreenfield, onClose });

    await screen.findByText(ko["welcome.lang.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));
    await screen.findByText(ko["welcome.look.title"]);
    fireEvent.click(screen.getByRole("button", { name: ko["welcome.next"] }));

    await screen.findByText(ko["welcome.project.title"]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ko["welcome.project.new"]) }));

    await waitFor(() => expect(onStartGreenfield).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(wrote(KEYS.onboarded)).toEqual(["true"]);
  });

  it("이미 끝낸 설정이면 출구에서 다시 적지 않는다", async () => {
    settingsEntries.current = [[KEYS.onboarded, "true"]];
    const onClose = vi.fn();
    renderWizard({ onClose });
    await screen.findByText(ko["welcome.lang.title"]);

    fireEvent.click(screen.getByRole("button", { name: ko["welcome.skip"] }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(wrote(KEYS.onboarded)).toEqual([]);
  });
});
