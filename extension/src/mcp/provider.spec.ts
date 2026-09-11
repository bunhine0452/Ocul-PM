import { describe, expect, it } from "vitest";

// `provider.ts` 는 vscode 를 임포트하므로 순수 부분만 따로 시험한다.
import { definitionsFor } from "./providerModel";

describe("definitionsFor — 바이너리 없으면 0개, 있으면 추적 폴더마다 하나", () => {
  it("null 바이너리 → []", () => {
    expect(definitionsFor(null, ["/a", "/b"], "copilot")).toEqual([]);
  });
  it("폴더마다 --root 와 cwd, agent id 는 env 로", () => {
    expect(definitionsFor("/bin/oculpm-mcp", ["/Users/me/ai-pm"], "copilot")).toEqual([
      { label: "oculpm (ai-pm)", command: "/bin/oculpm-mcp", args: ["--root", "/Users/me/ai-pm"], cwd: "/Users/me/ai-pm", env: { OCULPM_AGENT_ID: "copilot" } },
    ]);
  });
});
