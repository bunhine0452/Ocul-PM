import { describe, expect, it } from "vitest";

import { applyThemeAttrs, followsSystem, resolveThemeAttrs } from "@/features/theme/apply";
import { DEFAULTS, entriesToSettings } from "@/lib/settings";

// 4.0 — the theme is light / dark / system and nothing else. Presets, user theme files and
// per-project themes were removed; a value saved by an older build must quietly read as
// "system" (someone who used a removed theme must not land on a broken screen).

const base = { colorTheme: "green", prefersDark: false } as const;

describe("resolveThemeAttrs", () => {
  it("a fixed value ignores the OS preference", () => {
    expect(resolveThemeAttrs({ ...base, themeSetting: "light", prefersDark: true }).family).toBe("light");
    expect(resolveThemeAttrs({ ...base, themeSetting: "dark", prefersDark: false }).family).toBe("dark");
  });

  it("system follows the OS preference", () => {
    expect(resolveThemeAttrs({ ...base, themeSetting: "system", prefersDark: true }).family).toBe("dark");
    expect(resolveThemeAttrs({ ...base, themeSetting: "system", prefersDark: false }).family).toBe("light");
  });

  it("removed preset ids and custom:<id> read as system", () => {
    for (const legacy of ["nord", "solarized", "dracula", "sepia", "high-contrast", "custom:abc"]) {
      expect(resolveThemeAttrs({ ...base, themeSetting: legacy, prefersDark: true }).family, legacy).toBe("dark");
      expect(followsSystem(legacy), legacy).toBe(true);
    }
    expect(followsSystem("light")).toBe(false);
    expect(followsSystem("dark")).toBe(false);
    expect(followsSystem("system")).toBe(true);
  });

  it("the accent setting becomes data-accent as is", () => {
    expect(resolveThemeAttrs({ ...base, themeSetting: "dark", colorTheme: "rose" }).accent).toBe("rose");
  });
});

describe("applyThemeAttrs", () => {
  it("sets data-theme and data-accent only - no data-preset, no inline variables", () => {
    const root = document.createElement("html");
    applyThemeAttrs(root, { family: "dark", accent: "teal" });
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-accent")).toBe("teal");
    expect(root.hasAttribute("data-preset")).toBe(false);
    expect(root.getAttribute("style")).toBeNull();
  });
});

describe("the stored theme setting", () => {
  it("an old preset or user theme value reads as system", () => {
    expect(entriesToSettings([["theme", "nord"]]).theme).toBe("system");
    expect(entriesToSettings([["theme", "custom:1234"]]).theme).toBe("system");
  });

  it("light, dark and system are read as they are", () => {
    for (const v of ["light", "dark", "system"] as const) {
      expect(entriesToSettings([["theme", v]]).theme).toBe(v);
    }
    expect(DEFAULTS.theme).toBe("system");
  });
});
