import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";

// X-02 (11-15, user decision "run only when pressed") — the plan's check command runs in a new shell session only
// after the person has seen the whole line in a dialog and pressed Run. The line goes to the shell as a command
// argument (terminal_env.rs `Launch::Check`), never typed into the tty: what was shown is what runs, an rc prompt
// cannot eat its first letter, and nothing is written to the terminal on the way.

const h = vi.hoisted(() => ({
  /** Every byte path into a terminal: `term_write` (bindings) and xterm paste (`pasteToTerm`). */
  writes: [] as unknown[][],
  focus: [] as number[],
}));

vi.mock("@/lib/bindings", async () => {
  const base = (await import("./plannerHarness")).plannerBindings();
  return {
    ...base,
    commands: new Proxy(base.commands, {
      get: (target, prop) => {
        if (prop !== "termWrite") return Reflect.get(target, prop);
        return (...args: unknown[]) => {
          h.writes.push(args);
          return Promise.resolve({ status: "ok" as const, data: null });
        };
      },
    }),
  };
});
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());
vi.mock("@/features/terminal/termStore", () => ({
  openTerm: vi.fn(async () => 42),
  pasteToTerm: vi.fn((...args: unknown[]) => void h.writes.push(args)),
}));

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { onTermFocusRequested } from "@/features/terminal/focusRequest";
import { prepareCheck } from "@/features/terminal/runCheck";
import { openTerm } from "@/features/terminal/termStore";
import { useWorkspace, WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { detail, item, plan, resetPlanFixtures, stage } from "./plannerHarness";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NEL = String.fromCharCode(0x85);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ROOT = "/Users/me/dev/ai-pm";
const REPO_CHECK = "pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked";

/** The window's project folder — the dialog says where the session opens. */
function Root({ children }: { children: ReactNode }) {
  const { setProjectMeta } = useWorkspace();
  useEffect(() => setProjectMeta("ai-pm", ROOT), [setProjectMeta]);
  return <>{children}</>;
}

function renderPlanner(check: string | null) {
  stage([detail(plan("p1"), [item("a", "todo", 0)], { check })]);
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <Root>
          <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
        </Root>
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const runButton = () => screen.findByRole("button", { name: t("plan.check.run") });
const dialog = () => screen.queryByRole("dialog", { name: t("plan.check.confirmTitle") });

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(await runButton());
  const d = dialog();
  expect(d).not.toBeNull();
  return d!;
}

/** The exact text the dialog says will run — the machine-text box, not a summary. */
function shownLine(d: HTMLElement): string {
  return d.querySelector(".plv-check-line")?.textContent ?? "";
}

let offFocus: () => void = () => {};
beforeEach(() => {
  resetPlanFixtures();
  h.writes = [];
  h.focus = [];
  vi.mocked(openTerm).mockClear();
  offFocus = onTermFocusRequested((id) => h.focus.push(id));
});
afterEach(() => {
  offFocus();
  cleanup();
});

describe("run the check command in a shell — only when pressed", () => {
  it("shows the whole command and the folder before anything runs, with Cancel focused", async () => {
    renderPlanner(REPO_CHECK);
    const d = await openDialog();
    expect(shownLine(d)).toBe(REPO_CHECK);
    expect(within(d).getByText(ROOT)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(d).getByRole("button", { name: t("common.cancel") }));
    expect(openTerm).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("Run opens one terminal session carrying that one line, shows it, and writes nothing", async () => {
    renderPlanner(REPO_CHECK);
    const d = await openDialog();
    fireEvent.click(within(d).getByRole("button", { name: t("plan.check.confirm") }));
    await waitFor(() => expect(h.focus).toEqual([42]));
    expect(vi.mocked(openTerm).mock.calls).toEqual([
      [1, null, null, false, { line: REPO_CHECK, label: t("plan.check.session") }],
    ]);
    expect(h.writes).toEqual([]);
    expect(dialog()).toBeNull();
  });

  it("Cancel and Esc write nothing and open nothing", async () => {
    renderPlanner(REPO_CHECK);
    fireEvent.click(within(await openDialog()).getByRole("button", { name: t("common.cancel") }));
    expect(dialog()).toBeNull();
    fireEvent.keyDown(await openDialog(), { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(openTerm).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
    expect(h.focus).toEqual([]);
  });

  it("strips control characters, and the line the dialog shows is the line that runs", async () => {
    const raw = `pnpm\ttest${ESC}[31m --run${BEL} ${ESC}]0;title${BEL}echo "a  b"`;
    const clean = 'pnpm test --run echo "a  b"';
    renderPlanner(raw);
    const d = await openDialog();
    expect(shownLine(d)).toBe(clean);
    fireEvent.click(within(d).getByRole("button", { name: t("plan.check.confirm") }));
    await waitFor(() => expect(openTerm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openTerm).mock.calls[0][4]).toEqual({ line: clean, label: t("plan.check.session") });
  });

  it("runs a check written as one code span without the backticks (they would be command substitution)", async () => {
    renderPlanner("`pytest -q`");
    const d = await openDialog();
    expect(shownLine(d)).toBe("pytest -q");
    fireEvent.click(within(d).getByRole("button", { name: t("plan.check.confirm") }));
    await waitFor(() => expect(openTerm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openTerm).mock.calls[0][4]).toMatchObject({ line: "pytest -q" });
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["NEL", NEL],
    ["U+2028", LS],
    ["U+2029", PS],
  ])("a command with a line break (%s) blocks the button and says why", async (_name, br) => {
    renderPlanner(`pnpm test${br}rm -rf ~`);
    const button = await runButton();
    // aria-disabled, not disabled — the button keeps focus so the reason is read (`lib/blocked.ts`).
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(t("plan.check.multiline"));
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    fireEvent.click(button);
    expect(dialog()).toBeNull();
    expect(openTerm).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("a plan without a check command has no button", async () => {
    renderPlanner(null);
    expect(await screen.findByText(t("plan.judge.noCheck"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("plan.check.run") })).toBeNull();
  });

  it("a check that is nothing but control characters has no button either", async () => {
    renderPlanner(`${ESC}[31m${BEL}`);
    expect(await screen.findByText(t("plan.judge.check"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("plan.check.run") })).toBeNull();
  });
});

describe("prepareCheck", () => {
  it("blocks a backtick left after the one span around the whole line — the shell would run it first", () => {
    expect(prepareCheck("test `uname` = Darwin")).toEqual({ kind: "backtick" });
    expect(prepareCheck("`a` && `b`")).toEqual({ kind: "backtick" });
  });

  it("finds a line break in the raw text, before the sanitizer folds CR or drops NEL", () => {
    expect(prepareCheck("a\rb").kind).toBe("multiline");
    expect(prepareCheck(`a${NEL}b`).kind).toBe("multiline");
    expect(prepareCheck("  pnpm test  ")).toEqual({ kind: "ok", line: "pnpm test" });
  });
});
