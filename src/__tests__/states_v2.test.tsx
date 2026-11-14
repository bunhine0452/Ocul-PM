/**
 * 상태 한 벌 — 로딩 · 빈 · 오류 (11-15).
 *
 *  - 로딩 → 빈 상태가 같은 자리에서 가운데 → 왼쪽으로 튀었다(기본값 center · start).
 *  - 로딩은 초록 세 호가 끝없이 돌았고, 스켈레톤은 끝없이 숨 쉬었다(영수증 규칙 6 · 1).
 *  - 오류 카드는 제목(12px, --t-bug 3.83:1)이 본문보다 작고 원문이 본문 서체였다. 렌더 경계는 인라인
 *    리터럴 가운데 정렬이었다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorCard } from "@/components/ErrorCard";
import { LoadingState } from "@/components/LoadingState";
import { t } from "@/i18n";

import { read } from "./designFs";

vi.mock("@/lib/oculpmLog", () => ({ oculpmLog: { error: vi.fn(), flow: vi.fn() } }));

const PRIM = read("styles/primitives.css").replace(/\/\*[\s\S]*?\*\//g, "");
const EMPTY = read("styles/empty.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (css: string, sel: string) => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === sel) return m[2];
  throw new Error(`no ${sel}`);
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LoadingState — still text after 300ms", () => {
  it("nothing at 299ms, the text at 301ms — no spinner", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild!;
    // 리전은 처음부터 서 있다(라이브 리전은 내용보다 먼저).
    expect(root.getAttribute("role")).toBe("status");
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(root.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(root.textContent).toBe(t("common.loading"));
    expect(root.querySelector("svg")).toBeNull();
  });

  it("defaults to start — the same slot as the empty state", () => {
    const { container } = render(<LoadingState />);
    expect(container.firstElementChild!.className).toContain("ls--start");
    const { container: c2 } = render(<LoadingState align="center" />);
    expect(c2.firstElementChild!.className).not.toContain("ls--start");
  });

  it("clears its clock on unmount — no late text after it is gone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { unmount } = render(<LoadingState />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the brand spinner is gone — it was the only loop outside the cold-start splash", () => {
    const app = read("App.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(app).not.toMatch(/ocul-spin|oculSpin/);
    expect(() => read("components/OculSpinner.tsx")).toThrow();
  });
});

describe("skeleton — a still surface", () => {
  it("primitives.css .skel has no animation", () => {
    expect(rule(PRIM, ".skel")).not.toMatch(/animation/);
    expect(PRIM).not.toMatch(/skelBreathe/);
  });
});

describe("EmptyState — one shape", () => {
  it("defaults to start alignment", () => {
    for (const density of ["plain", "compact", "rich"] as const) {
      const { container } = render(<EmptyState density={density}>x</EmptyState>);
      expect(container.firstElementChild!.className, density).toContain("es--start");
      cleanup();
    }
  });

  it("rich defaults — the slot's left line and top as is (no padding), 13px body text, content background", () => {
    const rich = rule(EMPTY, ".es--rich");
    expect(rich).toMatch(/padding:\s*0;/);
    expect(rich).not.toMatch(/52px/);
    expect(rule(EMPTY, ".es--rich.es--start")).toMatch(/margin:\s*0;/);
    const sentence = rule(EMPTY, ".es--rich .es-desc");
    expect(sentence).toMatch(/font-size:\s*var\(--fs-4\)/);
    expect(sentence).toMatch(/color:\s*var\(--text\)/);
    expect(rule(EMPTY, ".es-sub")).toMatch(/font-size:\s*var\(--fs-3\)[\s\S]*color:\s*var\(--text-2\)/);
    // 빈 상태가 바로 들어 있는 칸은 본문 바탕 — 계획 칸(카드 바탕)도 그대로 따라온다.
    expect(rule(EMPTY, ":has(> .es.es--rich)")).toMatch(/background-color:\s*var\(--bg-content\)/);
  });
});

describe("ErrorCard — danger-text title, raw error in mono", () => {
  it("title 13/600 --danger-text · raw mono · retry", () => {
    const retry = vi.fn();
    render(<ErrorCard title="Could not load the journal" error="os error 2 (No such file)" onRetry={retry} />);
    const card = screen.getByRole("alert");
    expect(card.className).toContain("err-card");
    const title = card.querySelector(".err-title")!;
    expect(title.textContent).toBe("Could not load the journal");
    const raw = card.querySelector("pre.err-raw")!;
    expect(raw.textContent).toBe("os error 2 (No such file)");
    screen.getByRole("button", { name: t("common.retry") }).click();
    expect(retry).toHaveBeenCalledTimes(1);

    const titleCss = rule(PRIM, ".err-title");
    expect(titleCss).toMatch(/font-size:\s*var\(--fs-4\)/);
    expect(titleCss).toMatch(/font-weight:\s*var\(--fw-strong\)/);
    expect(titleCss).toMatch(/color:\s*var\(--danger-text\)/);
    expect(rule(PRIM, ".err-raw")).toMatch(/font-family:\s*var\(--mono\)/);
  });
});

describe("ErrorBoundary — the one error card", () => {
  function Boom(): never {
    throw new Error("render exploded");
  }

  it("a broken piece stands as an ErrorCard and retry remounts the subtree", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary label="test">
        <Boom />
      </ErrorBoundary>,
    );
    quiet.mockRestore();
    const card = container.querySelector(".err-wrap > .err-card")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".err-title")?.textContent).toBe(t("crash.title"));
    expect(card.querySelector("pre.err-raw")?.textContent).toBe("render exploded");
    expect(card.querySelector(".err-hint")?.textContent).toBe(t("crash.body"));
    // 가운데 정렬 인라인 리터럴은 걷었다.
    expect(container.querySelector("[style]")).toBeNull();
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeInTheDocument();
  });
});
