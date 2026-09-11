import { describe, expect, it } from "vitest";
import { isRegistered, mergeCursorMcpJson } from "./mcpJson";

const entry = { binary: "/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp", root: "/p", agentId: "cursor" };

describe("mergeCursorMcpJson — register.rs 규율", () => {
  it("파일이 없으면 만들고, 남의 키는 보존하고, 두 번째는 무변경", () => {
    const first = mergeCursorMcpJson(null, entry);
    expect(first.kind).toBe("write");
    if (first.kind !== "write") { return; }
    expect(first.created).toBe(true);
    const foreign = JSON.stringify({ mcpServers: { github: { command: "npx", args: ["gh-mcp"] }, oculpm: { command: "/old/oculpm-mcp" } }, other: 1 });
    const merged = mergeCursorMcpJson(foreign, entry);
    expect(merged.kind).toBe("write");
    if (merged.kind !== "write") { return; }
    const v = JSON.parse(merged.text);
    expect(v.other).toBe(1);
    expect(v.mcpServers.github).toEqual({ command: "npx", args: ["gh-mcp"] });
    expect(v.mcpServers.oculpm).toEqual({ command: entry.binary, args: ["--root", "/p"], env: { OCULPM_AGENT_ID: "cursor" } });
    expect(merged.text.endsWith("\n")).toBe(true);
    expect(mergeCursorMcpJson(merged.text, entry)).toEqual({ kind: "unchanged" });
  });

  it("손상 JSON·객체 아님은 error 로 돌려주고 내용을 만들지 않는다", () => {
    expect(mergeCursorMcpJson("{ \"mcpServers\": { broken", entry).kind).toBe("error");
    expect(mergeCursorMcpJson("[1,2]", entry).kind).toBe("error");
    expect(mergeCursorMcpJson("{ \"mcpServers\": 3 }", entry).kind).toBe("error");
  });

  it("isRegistered — 키 또는 서명", () => {
    expect(isRegistered(null)).toBe(false);
    expect(isRegistered("{ \"mcpServers\": { \"x\": { \"command\": \"/a/oculpm-mcp\" } } }")).toBe(true);
    expect(isRegistered("{ \"mcpServers\": { \"oculpm\": {} } }")).toBe(true);
    expect(isRegistered("{ \"mcpServers\": { \"gh\": {} } }")).toBe(false);
    expect(isRegistered("not json")).toBe(false);
  });
});
