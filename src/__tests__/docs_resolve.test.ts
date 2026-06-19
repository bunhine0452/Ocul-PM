import { describe, expect, it } from "vitest";
import {
  classifyHref,
  dirOf,
  displayName,
  isMarkdownPath,
  resolveRelative,
} from "@/features/docs/resolveDocsPath";

describe("dirOf", () => {
  it("returns the directory portion", () => {
    expect(dirOf("docs/sub/01-x.md")).toBe("docs/sub");
    expect(dirOf("docs/README.md")).toBe("docs");
    expect(dirOf("README.md")).toBe("");
  });
});

describe("resolveRelative", () => {
  const cur = "docs/sub/01-spec.md";

  it("resolves sibling './' links against the current dir", () => {
    expect(resolveRelative(cur, "./02-other.md")).toBe("docs/sub/02-other.md");
    expect(resolveRelative(cur, "02-other.md")).toBe("docs/sub/02-other.md");
  });

  it("walks up with '../'", () => {
    expect(resolveRelative(cur, "../graph/00-master.md")).toBe("docs/graph/00-master.md");
    expect(resolveRelative(cur, "../../top.md")).toBe("top.md");
  });

  it("treats a leading slash as project-root relative", () => {
    expect(resolveRelative(cur, "/docs/x.md")).toBe("docs/x.md");
  });

  it("collapses redundant '.' and empty segments", () => {
    expect(resolveRelative(cur, "./././img/./logo.png")).toBe("docs/sub/img/logo.png");
  });

  it("decodes percent-encoded segments (e.g. Korean / spaces)", () => {
    expect(resolveRelative(cur, "./%EB%AA%A9%EC%97%85.png")).toBe("docs/sub/목업.png");
    expect(resolveRelative(cur, "./a%20b.md")).toBe("docs/sub/a b.md");
  });
});

describe("classifyHref", () => {
  const cur = "docs/sub/01-spec.md";

  it("flags external schemes and protocol-relative URLs", () => {
    expect(classifyHref("https://x.com", cur)).toEqual({ kind: "external", href: "https://x.com" });
    expect(classifyHref("mailto:a@b.com", cur).kind).toBe("external");
    expect(classifyHref("//cdn.example.com/x.png", cur).kind).toBe("external");
  });

  it("flags pure anchors", () => {
    expect(classifyHref("#section-1", cur)).toEqual({ kind: "anchor", hash: "#section-1" });
  });

  it("resolves relative links and splits off a trailing hash", () => {
    expect(classifyHref("../graph/00.md#intro", cur)).toEqual({
      kind: "relative",
      path: "docs/graph/00.md",
      hash: "#intro",
    });
    expect(classifyHref("./02.md", cur)).toEqual({
      kind: "relative",
      path: "docs/sub/02.md",
      hash: null,
    });
  });
});

describe("isMarkdownPath / displayName", () => {
  it("detects markdown extensions", () => {
    expect(isMarkdownPath("docs/a.md")).toBe(true);
    expect(isMarkdownPath("docs/a.markdown")).toBe(true);
    expect(isMarkdownPath("docs/a.MDX")).toBe(true);
    expect(isMarkdownPath("docs/a.png")).toBe(false);
  });

  it("strips the extension but keeps the numeric prefix", () => {
    expect(displayName("00-master-plan.md")).toBe("00-master-plan");
    expect(displayName("README.md")).toBe("README");
  });
});
