import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import type { DiscussionSummary, DiscussionDetail } from "@/lib/bindings";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

function summary(over: Partial<DiscussionSummary> = {}): DiscussionSummary {
  return {
    discussion_id: "cache-strategy",
    title: "캐시 전략 결정",
    status: "open",
    owner: "user",
    problem_preview: "캐시 경로를 어디에 둘지 정해야 한다",
    option_count: 2,
    next_step_count: 1,
    resolution_plan_id: null,
    file_path: ".oculpm/discussion/cache-strategy/discussion.md",
    created_at: "2026-06-29",
    updated_at: "2026-06-29",
    ...over,
  };
}

function detail(): DiscussionDetail {
  return {
    discussion: summary(),
    problem: "패키징 .app 의 CWD 가 / 라서 캐시가 깨진다.",
    background: "",
    options: [
      { option_id: "opt-a", title: "방안 A — 절대경로", body: "장점: CWD 무관", order_idx: 0 },
      { option_id: "opt-b", title: "방안 B — 번들 동봉", body: "단점: 용량", order_idx: 1 },
    ],
    log: [{ ts: "2026-06-29T10:00:00+09:00", author: "user", body: "A 가 나아 보임" }],
    conclusion: "",
    next_steps: [{ step_id: "n1", title: "절대경로 적용", done: false, order_idx: 0 }],
    attachments: [],
    resolution_plan_id: null,
    resolution_decided_at: null,
    tags: [],
    warnings: [],
  };
}

const fx: {
  list: DiscussionSummary[];
  detail: DiscussionDetail | null;
  raw: string;
  written: string[];
} = {
  list: [],
  detail: null,
  raw: "",
  written: [],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "discussionList":
              return () => ok(fx.list);
            case "discussionGet":
              return () => ok(fx.detail);
            case "discussionReadRaw":
              return () => ok(fx.raw);
            case "discussionWrite":
              return (_p: number, _id: string, body: string) => {
                fx.written.push(body);
                return ok(fx.detail);
              };
            case "settingsGetAll":
              return () => ok([]);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { DiscussionScreenV2 } from "@/features/discussion/DiscussionScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

beforeEach(() => {
  fx.list = [];
  fx.detail = null;
  fx.raw = "";
  fx.written = [];
});
afterEach(cleanup);

describe("DiscussionScreenV2", () => {
  it("renders the list and the selected discussion detail", async () => {
    fx.list = [summary()];
    fx.detail = detail();
    const { findByText, findByRole } = render(wrap(<DiscussionScreenV2 projectId={1} onNavigate={vi.fn()} />));
    // header title (auto-selected first item) + an option unique to the detail
    await findByRole("heading", { name: "캐시 전략 결정" });
    await findByText("방안 A — 절대경로");
    await findByText("절대경로 적용");
  });

  it("shows an empty state when there are no discussions", async () => {
    fx.list = [];
    const { findByText } = render(wrap(<DiscussionScreenV2 projectId={1} onNavigate={vi.fn()} />));
    await findByText(/아직 논의 문서가 없어요/);
  });

  it("‘프롬프트 복사’ 는 문서 경로와 규격 경로를 담은 지시문을 클립보드에 넣는다", async () => {
    // 이 버튼의 값은 "에이전트가 이 파일을 바로 읽게 만드는가" 하나다 —
    // 경로가 빠지면 붙여넣어도 아무 일도 안 일어난다.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fx.list = [summary()];
    fx.detail = detail();

    const { findByRole } = render(wrap(<DiscussionScreenV2 projectId={1} onNavigate={vi.fn()} />));
    fireEvent.click(await findByRole("button", { name: /프롬프트 복사/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain(".oculpm/discussion/cache-strategy/discussion.md");
    expect(prompt).toContain(".oculpm/agents/discussion-spec.md");
    expect(prompt).toContain("캐시 전략 결정");
  });

  it("메모 한 줄은 편집기를 열지 않고 managed block 에 append 된다", async () => {
    fx.list = [summary()];
    fx.detail = detail();
    fx.raw = [
      "## 문제 정의",
      "x",
      "",
      "## 토의 / 메모",
      "",
      "<!-- oculpm:discussion-log begin v1 -->",
      "<!-- oculpm:discussion-log end -->",
      "",
    ].join("\n");

    const { findByLabelText, getByRole } = render(
      wrap(<DiscussionScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    const input = await findByLabelText("토의 메모 한 줄");
    fireEvent.change(input, { target: { value: "A 로 가자" } });
    fireEvent.click(getByRole("button", { name: "메모 추가" }));

    await waitFor(() => expect(fx.written).toHaveLength(1));
    const body = fx.written[0];
    expect(body).toContain("| user | A 로 가자 |");
    expect(body.indexOf("A 로 가자")).toBeLessThan(body.indexOf("discussion-log end"));
  });

  it("has no axe violations with data", async () => {
    fx.list = [summary()];
    fx.detail = detail();
    const { container, findByText } = render(wrap(<DiscussionScreenV2 projectId={1} onNavigate={vi.fn()} />));
    await findByText("방안 A — 절대경로");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
