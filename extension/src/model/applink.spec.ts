import { describe, expect, it } from "vitest";
import { appLink, nextCommand } from "./applink";

describe("app link", () => {
  it("builds the app's deep link — the app parses project, view, journal and plan", () => {
    expect(appLink("/Users/me/my proj", { kind: "view", view: "today" })).toBe("oculpm://open?project=%2FUsers%2Fme%2Fmy%20proj&view=today");
    expect(appLink("/p", { kind: "journal", path: "20261103/Bugs/0113_bug_x.md" })).toBe(
      "oculpm://open?project=%2Fp&journal=20261103%2FBugs%2F0113_bug_x.md",
    );
    expect(appLink("/p", { kind: "plan", id: "direction-20261102" })).toBe("oculpm://open?project=%2Fp&plan=direction-20261102");
  });

  it("types the plugin's next skill, and keeps the plan id to a plain name", () => {
    expect(nextCommand(null)).toBe('claude "/oculpm:next"');
    expect(nextCommand("evidence-moat-20261102")).toBe('claude "/oculpm:next evidence-moat-20261102"');
    expect(nextCommand('x"; rm -rf ~')).toBe('claude "/oculpm:next xrm-rf"');
  });
});
