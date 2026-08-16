import { describe, expect, it } from "vitest";
import { langIdForPath, langLabel, langExtensionForPath } from "@/features/code/codeLang";

// 코드 화면 — 확장자 → 언어 매핑 계약 (docs/code-editor/00-master-plan.md).

describe("langIdForPath", () => {
  it("maps common extensions to language ids", () => {
    expect(langIdForPath("src/lib/bindings.ts")).toBe("typescript");
    expect(langIdForPath("src/App.tsx")).toBe("typescript");
    expect(langIdForPath("scripts/check.mjs")).toBe("javascript");
    expect(langIdForPath("src-tauri/src/lib.rs")).toBe("rust");
    expect(langIdForPath("tools/gen.py")).toBe("python");
    expect(langIdForPath("cmd/main.go")).toBe("go");
    expect(langIdForPath("README.md")).toBe("markdown");
    expect(langIdForPath("package.json")).toBe("json");
    expect(langIdForPath("index.html")).toBe("html");
    expect(langIdForPath("styles/tokens.css")).toBe("css");
    expect(langIdForPath(".github/workflows/release.yml")).toBe("yaml");
    expect(langIdForPath("src-tauri/Cargo.toml")).toBe("toml");
    expect(langIdForPath("install.sh")).toBe("shell");
  });

  it("is case-insensitive on the extension", () => {
    expect(langIdForPath("NOTES.MD")).toBe("markdown");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(langIdForPath("LICENSE")).toBeNull();
    expect(langIdForPath("data.parquet")).toBeNull();
    // 점으로 시작하는 이름(확장자 없음)도 null — ".gitignore" 의 확장자는 없다.
    expect(langIdForPath(".gitignore")).toBeNull();
  });
});

describe("langLabel", () => {
  it("labels known ids and falls back to Plain Text", () => {
    expect(langLabel("typescript")).toBe("TypeScript");
    expect(langLabel("rust")).toBe("Rust");
    expect(langLabel(null)).toBe("Plain Text");
  });
});

describe("langExtensionForPath", () => {
  it("returns a CM extension for known languages and none for unknown", () => {
    expect(langExtensionForPath("a.rs").length).toBeGreaterThan(0);
    expect(langExtensionForPath("a.toml").length).toBeGreaterThan(0);
    expect(langExtensionForPath("LICENSE")).toHaveLength(0);
  });
});
