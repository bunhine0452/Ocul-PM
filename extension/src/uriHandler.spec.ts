import { describe, expect, it } from "vitest";
import { resolveEntryTarget } from "./uriHandlerModel";

describe("resolveEntryTarget — 열린 폴더 안의 규격 일지만", () => {
  const roots = ["/Users/me/ai-pm", "/Users/me/other"];
  it("폴더·경로 규약이 맞으면 대상", () => {
    const t = resolveEntryTarget("/Users/me/ai-pm/.oculpm/journal/20260911/Chores/1403_chore_x.md", roots);
    expect(t?.root).toBe("/Users/me/ai-pm");
    expect(t?.file.rel).toBe("20260911/Chores/1403_chore_x.md");
    expect(t?.file.slug).toBe("x");
  });
  it("폴더 밖·규격 밖·경로 탈출은 null", () => {
    expect(resolveEntryTarget("/Users/me/elsewhere/.oculpm/journal/20260911/Chores/1_chore_x.md", roots)).toBeNull();
    expect(resolveEntryTarget("/Users/me/ai-pm/.oculpm/journal/20260911/Chores/README.md", roots)).toBeNull();
    expect(resolveEntryTarget("/Users/me/ai-pm/.oculpm/journal/../../../etc/passwd", roots)).toBeNull();
    expect(resolveEntryTarget("/Users/me/ai-pm/src/x.md", roots)).toBeNull();
  });
});
