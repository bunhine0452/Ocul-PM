// ⌘K 편집의 귀속 — **로컬 히스토리에 누가 썼는지 남는가** {#agent-attribution}.
//
// 이 앱의 존재 이유가 기록이라 편집기가 자기 안에서 일어난 AI 편집을 사람
// 것으로 적으면 안 된다. 저장 창구는 사람이 ⌘S 를 누르든 ⌘K 가 쓴 문장을
// 담아 저장하든 똑같은 `code_write` 라, 그 판을 가르는 것은 이 표시 하나다.
//
// 규칙은 둘이다: **한 번 적히고 지워진다**(안 지우면 그 파일의 이후 저장이 전부
// 에이전트가 되고, 안 적으면 ⌘K 가 쓴 판이 사람으로 남는다), 그리고 **파일마다
// 따로 선다**.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/api/llm", () => ({ llmApi: { chat: vi.fn() } }));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { createManualEntry: vi.fn() } }));

import { useCodeAi } from "@/features/code/inlineEdit/useCodeAi";
import type { Settings } from "@/lib/settings";

const settings = { coreProvider: "anthropic" } as unknown as Settings;

function mount() {
  return renderHook(() => useCodeAi({ projectId: 1, settings, activePath: "a.ts" }));
}

describe("저장까지 안 간 ⌘K 편집", () => {
  it("⌘K 를 받은 파일의 **다음 저장만** 에이전트다", () => {
    const { result } = mount();
    expect(result.current.takeAgentAuthored("a.ts")).toBe(false);

    act(() => result.current.onAccepted("a.ts", { added: 2, removed: 1 }));
    expect(result.current.takeAgentAuthored("a.ts")).toBe(true);
    // 저장이 끝났으면 그다음 판은 다시 사람 것이다.
    expect(result.current.takeAgentAuthored("a.ts")).toBe(false);
  });

  it("표시는 파일마다 따로 선다", () => {
    const { result } = mount();
    act(() => result.current.onAccepted("a.ts", { added: 1, removed: 0 }));
    expect(result.current.takeAgentAuthored("b.ts")).toBe(false);
    expect(result.current.takeAgentAuthored("a.ts")).toBe(true);
  });

  it("파일이 없으면 아무것도 안 적는다", () => {
    const { result } = mount();
    act(() => result.current.onAccepted(null, { added: 1, removed: 0 }));
    expect(result.current.takeAgentAuthored(null)).toBe(false);
  });

  // 일지 누적(`tallies`)과는 **다른 축**이다 — 저장이 일지를 지우지 않는다.
  it("저장 표시를 가져가도 일지 칩은 남는다", () => {
    const { result } = mount();
    act(() => result.current.onAccepted("a.ts", { added: 3, removed: 0 }));
    expect(result.current.chip).not.toBeNull();
    expect(result.current.takeAgentAuthored("a.ts")).toBe(true);
    expect(result.current.chip).not.toBeNull();
  });
});
