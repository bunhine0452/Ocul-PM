import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ─── journal-scale-round {#release-notes-draft} ─────────────────────────────
//
// 이 시트의 계약은 둘이다:
//   1. 범위·「AI 로 다듬기」를 그대로 백엔드에 넘긴다 (빈 칸 = null = 기본값).
//   2. 산출물은 **클립보드까지**다 — 앱은 CHANGELOG 를 고치지 않고, 그 사실을
//      화면이 말한다. 이 테스트가 그 문장이 사라지는 것을 막는다.

type Draft = {
  markdown: string;
  commits: number;
  entries: number;
  linked: number;
  from_ref: string | null;
  to_ref: string;
  used_llm: boolean;
  note: string | null;
};

const fixtures: {
  draft: Draft;
  /** 시트가 실제로 물은 (projectId, from, to, useLlm). */
  asked: Array<[number, string | null, string | null, boolean]>;
} = {
  draft: {
    markdown: "## v?\n\nRange `v3.3.0..HEAD`",
    commits: 7,
    entries: 3,
    linked: 2,
    from_ref: "v3.3.0",
    to_ref: "HEAD",
    used_llm: false,
    note: null,
  },
  asked: [],
};

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    releaseNotesDraft: (
      projectId: number,
      fromRef: string | null,
      toRef: string | null,
      useLlm: boolean,
    ) => {
      fixtures.asked.push([projectId, fromRef, toRef, useLlm]);
      return Promise.resolve(fixtures.draft);
    },
  },
}));

const toasts: string[] = [];
vi.mock("@/lib/toast", () => ({
  toast: {
    info: (m: string) => toasts.push(m),
    destructive: (m: string) => toasts.push(m),
  },
}));

import { ReleaseNotesSheet } from "@/features/branch/ReleaseNotesSheet";
import { t } from "@/i18n";

beforeEach(() => {
  fixtures.asked = [];
  toasts.length = 0;
});
afterEach(cleanup);

describe("ReleaseNotesSheet", () => {
  it("passes an empty range as null and renders the draft with its counts", async () => {
    const copied: string[] = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: (s: string) => {
          copied.push(s);
          return Promise.resolve();
        },
      },
    });

    const { container } = render(<ReleaseNotesSheet projectId={4} open onClose={() => {}} />);

    // 초안 전에는 복사가 이유를 말하며 막혀 있다.
    const copyBtn = screen.getByText(t("branch.relnotes.copy"));
    expect(copyBtn.getAttribute("aria-disabled")).toBe("true");
    expect(copyBtn.getAttribute("title")).toBe(t("branch.relnotes.blockedNoDraft"));

    fireEvent.click(screen.getByText(t("branch.relnotes.generate")));
    await waitFor(() => expect(fixtures.asked).toEqual([[4, null, null, false]]));

    // 미리보기는 **원문 그대로**다 — 붙여 넣을 것이 화면에 있는 것과 같아야
    // 하므로 렌더된 마크다운이 아니라 `<pre>` 의 텍스트를 본다.
    await waitFor(() =>
      expect(container.querySelector("pre")?.textContent).toBe(fixtures.draft.markdown),
    );
    expect(
      screen.getByText(
        t("branch.relnotes.stats", { commits: 7, entries: 3, linked: 2 }),
        { exact: false },
      ),
    ).toBeTruthy();

    // 복사는 클립보드까지다 — 어떤 파일도 쓰지 않는다.
    fireEvent.click(screen.getByText(t("branch.relnotes.copy")));
    await waitFor(() => expect(copied).toEqual([fixtures.draft.markdown]));
    expect(toasts).toContain(t("branch.relnotes.copied"));

    // 「CHANGELOG 맨 위에 붙여넣기」도 같은 마크다운을 복사하고, 붙여 넣을
    // 자리를 말해 준다 (앱이 파일을 고친다는 오해를 만들지 않는다).
    fireEvent.click(screen.getByText(t("branch.relnotes.paste")));
    await waitFor(() => expect(copied.length).toBe(2));
    expect(toasts).toContain(t("branch.relnotes.pasteHint"));

    // 다섯 면 규율은 늘 보인다.
    expect(screen.getByText(t("branch.relnotes.discipline"))).toBeTruthy();
    expect(screen.getByText(t("branch.relnotes.noWrite"))).toBeTruthy();
  });

  it("passes the typed range and the AI toggle through unchanged", async () => {
    render(<ReleaseNotesSheet projectId={1} open onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(t("branch.relnotes.fromHint")), {
      target: { value: " v3.2.0 " },
    });
    fireEvent.change(screen.getByPlaceholderText(t("branch.relnotes.toHint")), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByLabelText(t("branch.relnotes.ai")));
    fireEvent.click(screen.getByText(t("branch.relnotes.generate")));

    await waitFor(() => expect(fixtures.asked).toEqual([[1, "v3.2.0", "main", true]]));
  });
});
