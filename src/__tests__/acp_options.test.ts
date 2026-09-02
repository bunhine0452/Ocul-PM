import { describe, expect, it } from "vitest";
import type { AcpConfigOption } from "@/lib/bindings";
import { sameOptions } from "@/features/chat/acpOptions";

// 되읽기가 **같은 값을 새 배열로** 준다는 사실이 화면을 무한 루프에 빠뜨렸다
// (acp_idle_traffic.test.tsx 에 전말). 그 고리를 끊는 것이 이 비교라, 여기서
// 틀리면 둘 중 하나가 된다: 다시 끝없이 돌거나, 바뀐 모델이 화면에 안 뜨거나.

function option(over: Partial<AcpConfigOption> = {}): AcpConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    current: "opus",
    choices: [{ value: "opus", name: "Opus", description: "The strongest one" }],
    is_boolean: false,
    ...over,
  };
}

describe("sameOptions", () => {
  it("calls two different arrays equal when their contents match", () => {
    expect(sameOptions([option()], [option()])).toBe(true);
  });

  it("treats two empty lists as equal", () => {
    expect(sameOptions([], [])).toBe(true);
  });

  it("differs when the current value changed — that is how a model swap reaches the screen", () => {
    expect(sameOptions([option()], [option({ current: "haiku" })])).toBe(false);
  });

  it("differs when a choice was added — a new model must show up in the selector", () => {
    const grown = option({
      choices: [
        { value: "opus", name: "Opus", description: "The strongest one" },
        { value: "haiku", name: "Haiku", description: null },
      ],
    });
    expect(sameOptions([option()], [grown])).toBe(false);
  });

  it("differs when only a choice description changed — that is the menu\u0027s second line", () => {
    const reworded = option({
      choices: [{ value: "opus", name: "Opus", description: "reworded" }],
    });
    expect(sameOptions([option()], [reworded])).toBe(false);
  });

  it("differs when the option count differs", () => {
    expect(sameOptions([option()], [option(), option({ id: "mode" })])).toBe(false);
  });

  it("differs when an option was replaced by another", () => {
    expect(sameOptions([option()], [option({ id: "mode", name: "Permission mode" })])).toBe(false);
  });
});
