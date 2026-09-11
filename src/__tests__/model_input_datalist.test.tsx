import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { ModelInput, resetModelListCache } from "@/features/settings/tabs/ModelInput";

// 감사 라운드 2026-09-11 B2 — 모델 칸이 프로바이더의 실제 목록을 datalist 로
// 띄운다. 계약: 초점 한 번에 한 번만 부르고, 성공하면 옵션이 생기고, 실패는
// 이유를 적되 칸은 그대로 쓸 수 있다.

const calls = vi.hoisted(() => ({ list: [] as string[], fail: false }));

vi.mock("@/lib/bindings", () => ({
  commands: {
    llmListModels: (provider: string) => {
      calls.list.push(provider);
      if (calls.fail) return Promise.resolve({ status: "error" as const, error: "API key for anthropic is not set" });
      return Promise.resolve({
        status: "ok" as const,
        data: [
          { id: "claude-opus-5", label: "Claude Opus 5" },
          { id: "claude-sonnet-5", label: "claude-sonnet-5" },
        ],
      });
    },
  },
  events: {},
}));

beforeEach(() => {
  calls.list = [];
  calls.fail = false;
  resetModelListCache();
});
afterEach(cleanup);

describe("ModelInput", () => {
  it("fetches once on focus and offers the ids as a datalist", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ModelInput provider="anthropic" value="" placeholder="claude-sonnet-5" onChange={onChange} />,
    );
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.focus(input);
    await waitFor(() => expect(container.querySelectorAll("datalist option")).toHaveLength(2));
    expect(calls.list).toEqual(["anthropic"]);
    expect(input.getAttribute("list")).toBe(container.querySelector("datalist")!.id);
    expect(container.querySelector("datalist option")!.getAttribute("value")).toBe("claude-opus-5");

    fireEvent.change(input, { target: { value: "claude-opus-5" } });
    expect(onChange).toHaveBeenCalledWith("claude-opus-5");
  });

  it("keeps the field usable and says why when the list fails", async () => {
    calls.fail = true;
    const { container } = render(
      <ModelInput provider="anthropic" value="x" placeholder="" onChange={() => {}} />,
    );
    fireEvent.focus(container.querySelector("input")!);
    await waitFor(() => expect(container.textContent).toContain("API key for anthropic is not set"));
    expect(container.querySelector("datalist")).toBeNull();
    expect(container.querySelector("input")!.hasAttribute("list")).toBe(false);
  });
});
