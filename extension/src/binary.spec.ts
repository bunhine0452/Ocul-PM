import { describe, expect, it } from "vitest";
import { defaultCandidates, findOculpmMcp, isExecutableFile } from "./binary";

describe("findOculpmMcp", () => {
  const none = async () => false;

  it("후보가 하나도 없으면 null — throw 하지 않는다 (읽기 전용 강등의 근거)", async () => {
    const r = await findOculpmMcp(undefined, [], none);
    expect(r).toEqual({ path: null, source: null, tried: [] });
    const r2 = await findOculpmMcp("   ", ["/a", "/b"], none);
    expect(r2.path).toBeNull();
    expect(r2.tried).toEqual(["/a", "/b"]);
  });

  it("설정 경로가 있으면 앱 후보보다 먼저, 없으면 /Applications → ~/Applications 순", async () => {
    const only = (hit: string) => async (p: string) => p === hit;
    expect((await findOculpmMcp("/custom/oculpm-mcp", ["/a", "/b"], only("/custom/oculpm-mcp"))).source).toBe("setting");
    expect((await findOculpmMcp("/custom/x", ["/a", "/b"], only("/a"))).source).toBe("applications");
    expect((await findOculpmMcp(undefined, ["/a", "/b"], only("/b"))).source).toBe("home-applications");
  });

  it("기본 후보는 두 .app 안의 사이드카", () => {
    expect(defaultCandidates("/Users/me")).toEqual([
      "/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
      "/Users/me/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
    ]);
  });

  it("isExecutableFile — 디렉터리·부재는 false", async () => {
    expect(await isExecutableFile("/")).toBe(false);
    expect(await isExecutableFile("/definitely/not/here")).toBe(false);
  });
});
