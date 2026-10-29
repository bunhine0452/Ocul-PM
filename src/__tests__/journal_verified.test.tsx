import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JournalEntrySummary } from "@/lib/bindings";

// ─── 일지 상세 (4.0) — 검증 상자 · 확인 토글 · 인라인 diff ──────────────────────
//
// 일지의 「검증」 은 에이전트의 말이 아니라 돌린 명령과 결과 끝 줄이어야 한다. 상세는 그 근거를 diff
// 앞에 놓고(명령 증거가 없으면 경고 칩 + 「주장이에요」 한 줄), 사람 확인(`확인함`)은 증거와 다른
// 사실이라 토글을 따로 둔다. 확인은 내용에 묶인다 — 확인 뒤 본문이 바뀌면(`verified_stale`) 「다시 검토」
// ({#reviewed-hash}). `journal_v2.test.tsx` 의 형제 — 화면 전체가 아니라 `JournalRow` ·
// `JournalDetail` 을 직접 그린다.

function summary(over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  return {
    relative_path: "20260531/Features_to_add/1000_feature_x.md",
    workday: "20260531",
    type: "feature",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "샘플 작업",
    checkbox: null,
    session_id: "20260531-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 0,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 0,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

// `vi.mock` 팩토리가 직접 참조하므로 hoisted.
const mocks = vi.hoisted(() => ({
  verify: [] as Array<{ projectId: number; relativePath: string; verified: boolean }>,
  body: "" as string,
  evidence: 0 as number,
  diffs: [] as Array<{ path: string; patch: string }>,
  filesTouched: [] as Array<{ path: string }>,
}));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("@/api/oculpm", () => {
  class MockOculpmApiError extends Error {}
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      getJournalEntry: (_pid: number, relativePath: string) =>
        Promise.resolve({
          relative_path: relativePath,
          title: "제목",
          body_markdown: mocks.body,
          evidence: mocks.evidence,
          frontmatter: {
            files_touched: mocks.filesTouched,
            related: [],
            agent: { id: "claude-code", version: "Opus 5.5" },
          },
        }),
      getEntryDiffs: () => Promise.resolve(mocks.diffs),
      suggestRelated: () => Promise.resolve([]),
      openEntryInEditor: () => Promise.resolve(null),
      // 백엔드는 `true` 에 지금 본문의 해시를 묶고, `false` 에 그 줄을 지운다.
      setJournalVerified: (pid: number, relativePath: string, verified: boolean) => {
        mocks.verify.push({ projectId: pid, relativePath, verified });
        return Promise.resolve(null);
      },
    },
  };
});

// 전체 본문의 <Markdown> 은 SettingsProvider 를 요구한다 — 여기선 글자만 본다.
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

import { JournalRow } from "@/features/oculpm/JournalRow";
import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { isConfirmed, isStaleVerified } from "@/features/oculpm/verified";
import { evidenceStateOf } from "@/features/oculpm/evidenceState";
import { verificationLines, withoutVerification } from "@/features/oculpm/verification";
import { NAV_BUS } from "@/lib/navRegistry";

function renderRow(entry: JournalEntrySummary) {
  return render(<JournalRow entry={entry} selected={false} onSelect={() => {}} />);
}

function renderDetail(
  entry: JournalEntrySummary,
  extra: Partial<React.ComponentProps<typeof JournalDetail>> = {},
) {
  const onOpenDiff = vi.fn();
  const utils = render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail
        projectId={1}
        entry={entry}
        planLinks={[]}
        onOpenDiff={onOpenDiff}
        onOpenRelated={() => {}}
        {...extra}
      />
    </WorkspaceProvider>,
  );
  return { ...utils, onOpenDiff };
}

const BODY_WITH_COMMAND =
  "[x] 샘플 작업\n\n## 발생 원인\n새 폴더 이벤트보다 쓰기가 먼저 끝났다.\n\n## 해결 방법\n등록 직후 한 번 훑는다.\n\n## 검증\n- `pnpm test` → 2064 passed\n";
const BODY_CLAIM_ONLY = "[x] 샘플 작업\n\n## 발생 원인\n경합이다.\n\n## 검증\n- 수동으로 확인했다\n";
const BODY_NO_SECTION = "[x] 샘플 작업\n\n## 발생 원인\n경합이다.\n";

beforeEach(() => {
  mocks.verify = [];
  mocks.body = BODY_WITH_COMMAND;
  mocks.evidence = 2;
  mocks.diffs = [];
  mocks.filesTouched = [];
  toastMock.destructive.mockClear();
});
afterEach(() => cleanup());

describe("isConfirmed / isStaleVerified — 「확인됨」의 뜻 하나", () => {
  it("플래그만으로는 확인이 아니다 — 확인 뒤 바뀐 일지는 confirmed 가 아니고 stale 이다", () => {
    const ok = summary({ verified_by_user: true });
    const stale = summary({ verified_by_user: true, verified_stale: true });
    const no = summary();
    expect([isConfirmed(ok), isStaleVerified(ok)]).toEqual([true, false]);
    expect([isConfirmed(stale), isStaleVerified(stale)]).toEqual([false, true]);
    expect([isConfirmed(no), isStaleVerified(no)]).toEqual([false, false]);
  });
});

describe("evidenceStateOf — 증거 / 확인 / 예외", () => {
  it("명령 증거(2)는 유형과 상관없이 command", () => {
    expect(evidenceStateOf(summary({ type: "chore", evidence: 2 }))).toBe("command");
  });
  it("증거를 요구하는 유형(결함·기능·리팩토링)이 명령도 확인도 없으면 missing — 칸만 있어도(1) 그렇다", () => {
    for (const type of ["bug", "feature", "refactor"] as const) {
      expect(evidenceStateOf(summary({ type, evidence: 0 }))).toBe("missing");
      expect(evidenceStateOf(summary({ type, evidence: 1 }))).toBe("missing");
    }
  });
  it("사람이 지금 내용을 확인했으면 confirmed, 확인 뒤 바뀌었으면 다시 missing", () => {
    expect(evidenceStateOf(summary({ type: "bug", verified_by_user: true }))).toBe("confirmed");
    expect(evidenceStateOf(summary({ type: "bug", verified_by_user: true, verified_stale: true }))).toBe("missing");
  });
  it("에러·잡일은 없는 것을 꾸짖지 않는다", () => {
    expect(evidenceStateOf(summary({ type: "chore" }))).toBe("none");
    expect(evidenceStateOf(summary({ type: "error" }))).toBe("none");
  });
});

describe("검증 칸 읽기", () => {
  it("목록 표식·백틱·코드 울타리를 벗기고 빈 줄은 건너뛴다", () => {
    const body = "## 검증\n\n- `cargo test` → ok\n```\n$ x\n```\n* **exit 0**\n\n## 메모\n다른 칸\n";
    expect(verificationLines(body)).toEqual(["cargo test → ok", "$ x", "exit 0"]);
  });
  it("영어 헤더도 읽고, 칸이 없으면 빈 배열", () => {
    expect(verificationLines("## Verification\n- ran it\n")).toEqual(["ran it"]);
    expect(verificationLines("## 발생 원인\n경합\n")).toEqual([]);
  });
  it("상세 본문은 검증 칸만 뺀다 — 검증은 상자가 따로 보인다 (화면 검사 {#journal-body})", () => {
    const body = "## 발생 원인\n경합\n\n## 검증\n- cargo test ok\n\n## 메모\n다른 칸\n";
    expect(withoutVerification(body)).toBe("## 발생 원인\n경합\n\n## 메모\n다른 칸");
    expect(withoutVerification("## 변경 요약\n했다\n")).toBe("## 변경 요약\n했다\n");
  });
});

describe("목록 행 — 증거 표시", () => {
  it("증거 없음은 경고 칩", () => {
    const { container } = renderRow(summary({ type: "bug", evidence: 0 }));
    expect(container.querySelector(".chip.warn")?.textContent).toBe("검증 없음");
  });
  it("명령 증거도 사람의 읽음도 목록에는 표시하지 않는다 — 목록은 예외만 (화면 검사 {#journal-list})", () => {
    const a = renderRow(summary({ evidence: 2 }));
    expect(a.container.querySelector('[role="img"][aria-label="검증 있음"]')).toBeNull();
    a.unmount();
    const b = renderRow(summary({ type: "bug", verified_by_user: true }));
    expect(b.container.querySelector('[role="img"][aria-label="읽음"]')).toBeNull();
    expect(b.container.querySelector(".chip.warn")).toBeNull();
  });
  it("확인 뒤 바뀐 일지는 체크가 아니라 다시 경고 칩이다", () => {
    const { container } = renderRow(summary({ type: "bug", verified_by_user: true, verified_stale: true }));
    expect(container.querySelector('[role="img"][aria-label="읽음"]')).toBeNull();
    expect(container.querySelector(".chip.warn")).not.toBeNull();
  });
  it("미완료는 칩으로 말하고, 잡일은 증거 요구가 없어 표시가 없다", () => {
    const { container } = renderRow(summary({ type: "chore", status: "in_progress" }));
    expect(container.querySelector(".chip.sm:not(.warn)")?.textContent).toBe("미완료");
    expect(container.querySelector(".chip.warn")).toBeNull();
  });
});

describe("상세 — 검증 상자", () => {
  it("명령 증거가 있으면 mono 상자에 돌린 명령과 결과 끝 줄이 서고 「주장」 문구는 없다", async () => {
    const { container, findByText, queryByText } = renderDetail(summary({ type: "bug", evidence: 2 }));
    expect(await findByText("명령 있음")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".jd-term")?.textContent).toBe("pnpm test → 2064 passed"));
    expect(queryByText(/이 일지는 주장일 뿐이에요/)).toBeNull();
  });

  it("검증 칸이 있어도 명령이 없으면 경고 칩 + 「주장이에요」 한 줄 + 에이전트가 쓴 문장 그대로", async () => {
    mocks.body = BODY_CLAIM_ONLY;
    mocks.evidence = 1;
    const { container, findByText } = renderDetail(summary({ type: "bug", evidence: 1 }));
    const chip = await findByText("명령 없음");
    expect(chip.className).toContain("warn");
    expect(await findByText(/돌린 명령과 결과 끝 줄이 없으면 이 일지는 주장일 뿐이에요/)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".jd-term")?.textContent).toBe("수동으로 확인했다"));
  });

  it("검증 칸이 아예 없으면 그렇게 말하고 mono 상자는 없다", async () => {
    mocks.body = BODY_NO_SECTION;
    mocks.evidence = 0;
    const { container, findByText } = renderDetail(summary({ type: "bug", evidence: 0 }));
    expect(await findByText("이 일지에는 검증을 적지 않았어요")).toBeInTheDocument();
    expect(container.querySelector(".jd-term")).toBeNull();
  });

  it("증거를 요구하지 않는 잡일에 검증 칸이 없으면 상자 자체를 그리지 않는다", async () => {
    mocks.body = BODY_NO_SECTION;
    mocks.evidence = 0;
    const { container } = renderDetail(summary({ type: "chore", evidence: 0 }));
    await waitFor(() => expect(container.querySelector(".jd-prose")).not.toBeNull());
    expect(container.querySelector(".jd-verify")).toBeNull();
  });

  it("헤더: 종류 · 증거 · 날짜 · 에이전트 · 모델 · 연결된 계획 → 제목 → 본문(검증 칸은 상자에만)", async () => {
    // 요약의 제목은 본문 첫 줄과 같다 (요약 행의 title 은 그 줄에서 온다).
    mocks.body = BODY_WITH_COMMAND.replace("샘플 작업", "새 폴더 감시 경합");
    mocks.evidence = 0;
    const { container } = renderDetail(summary({ type: "bug", evidence: 0, title: "새 폴더 감시 경합" }), {
      planLinks: [
        { journal_ref: "x", plan_id: "p", plan_title: "4.0 덜어내기", item_id: "drop-app-llm" },
        { journal_ref: "x", plan_id: "p", plan_title: "4.0 덜어내기", item_id: "other" },
      ],
    });
    expect(container.querySelector(".jd-title")?.textContent).toBe("새 폴더 감시 경합");
    // 본문은 접지 않고 바로 — 검증 칸은 빼서 상자와 두 번 읽히지 않는다 (화면 검사 {#journal-body}).
    await waitFor(() => expect(container.querySelector(".jd-prose")?.textContent).toContain("쓰기가 먼저 끝났다"));
    expect(container.querySelector(".jd-prose")?.textContent).not.toContain("2064 passed");
    expect(container.querySelector(".jd-full")).toBeNull();
    const meta = container.querySelector(".jd-meta")?.textContent ?? "";
    expect(meta).toContain("5월 31일 10:00");
    expect(meta).toContain("Claude Code");
    expect(meta).toContain("Opus 5.5");
    expect(meta).toContain("계획 「4.0 덜어내기」 #drop-app-llm +1");
    // 계획 줄은 글자 그대로의 링크 — 누르면 그 계획 항목으로 건너간다 (ocul-next #nav-links).
    const seen: unknown[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(NAV_BUS.openEntity, onOpen);
    fireEvent.click(container.querySelector(".jd-plan-link")!);
    window.removeEventListener(NAV_BUS.openEntity, onOpen);
    expect(seen).toEqual([{ kind: "plan_item", id: "p#drop-app-llm" }]);
    expect(container.querySelector(".tbadge")?.textContent).toContain("버그 수정");
    expect(container.querySelector(".jd-chips .chip.warn")?.textContent).toBe("검증 없음");
  });
});

describe("상세 — 확인함 토글 (사람 확인은 증거와 다른 사실)", () => {
  it("확인 안 된 일지: 「확인함」 을 누르면 true — 이때 백엔드가 해시를 묶고, 눌린 상태가 된다", async () => {
    const entry = summary({ relative_path: "20260531/F/1000_no.md", type: "bug", evidence: 1 });
    const { getByRole, findByRole } = renderDetail(entry);
    const btn = await findByRole("button", { name: "읽음", pressed: false });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.verify).toEqual([{ projectId: 1, relativePath: "20260531/F/1000_no.md", verified: true }]),
    );
    await waitFor(() => expect(getByRole("button", { name: "읽음", pressed: true })).toBeTruthy());
  });

  it("이미 확인된 일지: 눌린 상태로 시작하고, 다시 누르면 해제(false)", async () => {
    const entry = summary({ relative_path: "20260531/F/1000_ok.md", type: "bug", verified_by_user: true });
    const { getByRole, findByRole } = renderDetail(entry);
    fireEvent.click(await findByRole("button", { name: "읽음", pressed: true }));
    await waitFor(() =>
      expect(mocks.verify).toEqual([{ projectId: 1, relativePath: "20260531/F/1000_ok.md", verified: false }]),
    );
    await waitFor(() => expect(getByRole("button", { name: "읽음", pressed: false })).toBeTruthy());
  });

  it("확인 뒤 바뀐 일지: 눌리지 않은 「다시 검토」, 누르면 true 로 다시 묶는다", async () => {
    const entry = summary({
      relative_path: "20260531/F/1000_stale.md",
      type: "bug",
      verified_by_user: true,
      verified_stale: true,
    });
    const { getByRole, findByRole } = renderDetail(entry);
    fireEvent.click(await findByRole("button", { name: "다시 읽기", pressed: false }));
    await waitFor(() =>
      expect(mocks.verify).toEqual([{ projectId: 1, relativePath: "20260531/F/1000_stale.md", verified: true }]),
    );
    // 다시 묶였다 — 워처 왕복 없이 바로 눌린 「확인함」이다.
    await waitFor(() => expect(getByRole("button", { name: "읽음", pressed: true })).toBeTruthy());
  });
});

describe("상세 — 인라인 diff", () => {
  const two = [
    { path: "src/a.ts", patch: "@@ -1,2 +1,3 @@\n-const old = 1;\n+const first = 1;\n+const extra = 2;\n" },
    { path: "src/b.ts", patch: "@@ -1 +1 @@\n-let b = 0;\n+let second = 0;\n" },
  ];

  it("기록된 diff 를 기존 렌더러로 그리고, 파일명 · +N −M · 「파일 N 중 i」 를 헤더에 둔다", async () => {
    mocks.diffs = two;
    const { container, findByText } = renderDetail(summary({ type: "bug" }));
    expect(await findByText("src/a.ts")).toBeInTheDocument();
    await waitFor(() => expect(container.textContent).toContain("const first = 1;"));
    expect(container.querySelector(".jd-diff .diff-stat")?.textContent).toBe("+2−1");
    expect(container.querySelector(".jd-diff-pos")?.textContent).toBe("파일 2 중 1");
    expect(container.querySelector(".jd-diff .dl.add")).not.toBeNull();
  });

  it("「다음 파일」 로 옮기고 끝에서는 처음으로 돌아온다", async () => {
    mocks.diffs = two;
    const { container, getByText, findByText } = renderDetail(summary({ type: "bug" }));
    await findByText("src/a.ts");
    fireEvent.click(getByText("다음 파일"));
    await waitFor(() => expect(container.querySelector(".jd-diff-name")?.textContent).toBe("src/b.ts"));
    expect(container.querySelector(".jd-diff-pos")?.textContent).toBe("파일 2 중 2");
    await waitFor(() => expect(container.textContent).toContain("let second = 0;"));
    fireEvent.click(getByText("다음 파일"));
    await waitFor(() => expect(container.querySelector(".jd-diff-name")?.textContent).toBe("src/a.ts"));
  });

  it("파일이 하나면 이동 버튼이 없고, 패치 없는 파일은 개수로만 말한다", async () => {
    mocks.diffs = [two[0]];
    mocks.filesTouched = [{ path: "src/a.ts" }, { path: "src/gone.ts" }, { path: "src/lost.ts" }];
    const { container, queryByText, findByText } = renderDetail(summary({ type: "bug" }));
    await findByText("src/a.ts");
    expect(queryByText("다음 파일")).toBeNull();
    expect(await findByText("diff 가 기록되지 않은 파일 2개")).toBeInTheDocument();
    expect(container.querySelector(".jd-diff-pos")?.textContent).toBe("파일 1 중 1");
  });

  it("기록된 diff 가 없으면 그렇게 말하고 변경 화면으로 가는 길을 둔다", async () => {
    mocks.diffs = [];
    const { findByText, onOpenDiff } = renderDetail(summary({ type: "bug" }));
    expect(await findByText("이 일지에는 기록된 변경이 없어요.")).toBeInTheDocument();
    fireEvent.click(await findByText("변경 diff 화면에서 보기"));
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
  });
});
