import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ─── v3-surface / firstrun — 첫 5분이 사실을 말한다 ──────────────────────────
//
// 이 레인의 주제는 정직이라, 무는 것도 **문구가 아니라 사실과 행동**이다:
//
//  1. EmptyState 두 밀도가 한 컴포넌트로 갈린다 ({#empty-state-component}) —
//     그리고 그 쌍둥이 LoadingState 는 **같은 치수를 입되 갈린다**
//     ({#layout-loading-state}). 여덟 자리가 로딩을 빈 상태로 그렸고 그중
//     다섯은 두 분기가 같은 컴포넌트·같은 props 라, 사용자가 "기다리면
//     채워진다" 와 "원래 비어 있다" 를 구분할 수 없었다.
//  2. 정직성 감사가 문제를 나열만 하지 않고 무료 행동을 준다 ({#honesty-actions})
//     — 그리고 작성기에 실리는 씨앗에는 화면의 12개 상한이 아니라 **전부**가
//     들어간다 (상한은 화면의 사정이지 기록의 사정이 아니다).
//  3. 플러그인 카드는 **판정 근거가 있을 때만** 뜬다 ({#plugin-onboarding}) —
//     Claude Code 가 없으면 그리지 않는다. 추측 배지 금지.

const fx: {
  sessions: Array<{ session_id: string; unrecorded: string[]; unrecorded_severity: string }>;
  cli: { available: boolean } | null;
  plugin: { installed: boolean; path: string | null } | null;
} = { sessions: [], cli: null, plugin: null };

vi.mock("@/api/oculpm", () => ({
  oculpmApi: { compareWorkday: () => Promise.resolve({ sessions: fx.sessions }) },
  OculpmApiError: class extends Error {},
}));

vi.mock("@/api/claudeSurface", () => ({
  claudeInstallApi: {
    pluginStatus: () => Promise.resolve(fx.plugin),
    cli: () => Promise.resolve(fx.cli),
  },
}));

import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { HonestyAudit } from "@/features/today/HonestyAudit";
import { PluginSetupCard } from "@/features/today/PluginSetupCard";
import { consumeManualEntryRequest, _resetManualEntryRequest } from "@/lib/journalCompose";
import { t } from "@/i18n";

beforeEach(() => {
  fx.sessions = [];
  fx.cli = null;
  fx.plugin = null;
  _resetManualEntryRequest();
});
afterEach(cleanup);

describe("LoadingState — same slot, different signal", () => {
  it("wears .es--plain so the slot never shifts", () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild!;
    // 치수를 물려받는 것이 요점이다: 여백은 EmptyState 와 한 곳에서 나온다.
    expect(root.className).toContain("es");
    expect(root.className).toContain("es--plain");
    expect(root.className).toContain("ls");
  });

  it("differs from empty by the spinner and the status role", () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild!;
    // 상태 변화를 보조기술에 알리는 것은 이 쪽만이다 (EmptyState 는 role 없음).
    expect(root.getAttribute("role")).toBe("status");
    // 스피너는 aria-hidden — OculSpinner 가 자기 aria-label("불러오는 중")을
    // 갖고 있어서, 감싸지 않으면 같은 말을 두 번 읽는다.
    const spin = root.querySelector(".ls-spin")!;
    expect(spin.getAttribute("aria-hidden")).toBe("true");
    expect(spin.querySelector("svg")).not.toBeNull();
  });

  it("falls back to common.loading, the caller may say more", () => {
    const { container, rerender } = render(<LoadingState />);
    expect(container.textContent).toContain(t("common.loading"));
    rerender(<LoadingState>{t("diff.previewLoading")}</LoadingState>);
    expect(container.textContent).toContain(t("diff.previewLoading"));
  });
});

describe("EmptyState — two densities, one component", () => {
  it("plain renders just the line", () => {
    const { container } = render(<EmptyState>nothing here</EmptyState>);
    const root = container.firstElementChild!;
    expect(root.className).toContain("es--plain");
    expect(root.querySelector(".es-title")).toBeNull();
    expect(root.querySelector(".es-actions")).toBeNull();
  });

  it("rich renders icon, title, description and actions", () => {
    const { container } = render(
      <EmptyState
        density="rich"
        icon={(p) => <svg {...p} data-testid="ico" />}
        title="a title"
        actions={<button>do it</button>}
      >
        why it is empty
      </EmptyState>,
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain("es--rich");
    expect(screen.getByTestId("ico")).toBeInTheDocument();
    expect(screen.getByText("a title")).toBeInTheDocument();
    expect(screen.getByText("why it is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "do it" })).toBeInTheDocument();
  });
});

describe("HonestyAudit — showing the problem is not enough", () => {
  const many = Array.from({ length: 15 }, (_, i) => `src/f${i}.ts`);

  it("offers free actions and seeds the composer with every unrecorded path", async () => {
    fx.sessions = [{ session_id: "20260906-001", unrecorded: many, unrecorded_severity: "warning" }];
    const onNavigate = vi.fn();
    render(
      <HonestyAudit projectId={1} workday="20260906" enabled onNavigate={onNavigate} />,
    );

    const write = await screen.findByRole("button", { name: t("today.honesty.write") });
    expect(screen.getByRole("button", { name: t("today.honesty.copyPaths") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("today.honesty.review") }));
    expect(onNavigate).toHaveBeenCalledWith("diff");

    fireEvent.click(write);
    const seed = consumeManualEntryRequest();
    // 화면은 12개만 보여 주지만 씨앗에는 15개가 전부 실린다.
    expect(seed?.body?.split("\n")).toHaveLength(15);
    expect(seed?.body).toContain("src/f14.ts");
  });
});

describe("PluginSetupCard — no badge without evidence", () => {
  it("stays silent when Claude Code itself is not on the machine", async () => {
    fx.cli = { available: false };
    fx.plugin = { installed: false, path: null };
    const { container } = render(<PluginSetupCard show onNavigate={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("stays silent when the plugin probe already found it", async () => {
    fx.cli = { available: true };
    fx.plugin = { installed: true, path: "/x" };
    const { container } = render(<PluginSetupCard show onNavigate={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows the install commands when the CLI is there but the plugin is not", async () => {
    fx.cli = { available: true };
    fx.plugin = { installed: false, path: null };
    render(<PluginSetupCard show onNavigate={vi.fn()} />);
    expect(await screen.findByText(t("today.plugin.title"))).toBeInTheDocument();
    expect(screen.getByText("/plugin install oculpm@oculpm")).toBeInTheDocument();
    // 「못 찾음」 과 「미설치」 는 다른 말이다 — 이 판정은 놓칠 수 있다.
    expect(screen.getByText(t("today.plugin.notFoundNote"))).toBeInTheDocument();
  });

  it("draws nothing outside the first five minutes", async () => {
    fx.cli = { available: true };
    fx.plugin = { installed: false, path: null };
    const { container } = render(<PluginSetupCard show={false} onNavigate={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
