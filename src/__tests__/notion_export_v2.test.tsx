import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── PR-CI7 — Notion 내보내기: 토큰 게이트 + 검증→키체인 저장 계약 ──────────
//
// (a) 회고 화면: 토큰이 없으면 "Notion 으로" 버튼이 아예 없고(기능 비노출),
//     있으면 클릭 → notion_export(제목·본문) → open_url 로 새 페이지를 연다.
// (b) 설정 섹션: 토큰은 **검증 성공 후에만** secret_set(키체인)으로 저장되고,
//     검증 실패 시 어디에도 저장되지 않는다.

type Dict = Record<string, unknown>;

const fx = {
  hasToken: false,
  verifyOk: true,
  parent: null as string | null,
  calls: {
    verify: [] as unknown[][],
    secretSet: [] as unknown[][],
    setParent: [] as unknown[][],
    export: [] as unknown[][],
    openUrl: [] as unknown[][],
  },
};

const SIGNALS: Dict = {
  since: "20260714",
  until: "20260720",
  range_key: "20260714..20260720",
  signature: "sig",
  total_entries: 3,
  shipped: [],
  resistance: [],
  repeated_files: [],
  effort_hotspots: [],
  agent_breakdown: [{ agent_id: "claude-code", entry_count: 3, share: 1 }],
  difficulty_mix: { verylow: 0, low: 0, medium: 3, high: 0, superhigh: 0, null_count: 0 },
};

const CACHED: Dict = {
  project_id: 1,
  range_key: "20260714..20260720",
  signature: "sig",
  retro_md: "## 한눈에 보기\n\n좋은 한 주였다.",
  generated_at: 1752900000,
  generated_by_model: "claude-sonnet-5",
};

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

// 회고 화면이 마운트하는 DeferLedgerPanel(미룬 지름길 카드)이 워크스페이스·설정
// 컨텍스트를 쓴다 — 프로바이더 없는 이 하네스에선 훅이 throw 하므로 모킹한다.
// (deferSignals 는 아래 bindings Proxy 의 default 가 ok(null) 을 돌려 카드가
// 스스로 숨는다 — 이 파일의 Notion 단언에는 영향 없음.)
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ state: { currentProjectRoot: "/proj" } }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { externalEditorCommand: "code %path" } }),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "retroSignals":
              return () => ok(SIGNALS);
            case "getRetro":
              return () => ok(CACHED);
            case "evalSignals":
              return () => ok(null);
            case "ruleCandidates":
              return () => ok([]);
            case "skillCandidates":
              return () => ok([]);
            case "notionStatus":
              return () => ok({ has_token: fx.hasToken, parent_page_id: fx.parent });
            case "notionVerifyToken":
              return (...a: unknown[]) => {
                fx.calls.verify.push(a);
                return fx.verifyOk ? ok("팀 위키 봇") : err("unauthorized");
              };
            case "secretSet":
              return (...a: unknown[]) => {
                fx.calls.secretSet.push(a);
                fx.hasToken = true;
                return ok(null);
              };
            case "notionSetParent":
              return (...a: unknown[]) => {
                fx.calls.setParent.push(a);
                fx.parent = "12345678-90ab-cdef-1234-567890abcdef";
                return ok(fx.parent);
              };
            case "notionExport":
              return (...a: unknown[]) => {
                fx.calls.export.push(a);
                return ok("https://www.notion.so/team/page-abc");
              };
            case "openUrl":
              return (...a: unknown[]) => {
                fx.calls.openUrl.push(a);
                return ok(null);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { RetroScreenV2 } from "@/features/retro/RetroScreenV2";
import { NotionSection } from "@/features/settings/SettingsPanel";

beforeEach(() => {
  // 회고 제목 "회고 M/D–M/D" 는 new Date() 로 계산되므로, 실제 날짜가 지나면
  // 하드코딩한 기대 문자열이 깨진다. Date 만 고정(타이머는 실물 유지 → waitFor
  // 정상)해 range 를 결정적으로 만든다. 7/20(월) → since 7/14 · until 7/20.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
  fx.hasToken = false;
  fx.verifyOk = true;
  fx.parent = null;
  fx.calls.verify = [];
  fx.calls.secretSet = [];
  fx.calls.setParent = [];
  fx.calls.export = [];
  fx.calls.openUrl = [];
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("회고 화면 Notion 내보내기 (PR-CI7)", () => {
  it("토큰이 없으면 'Notion 으로' 버튼이 노출되지 않는다", async () => {
    const { findByText, queryByRole } = render(<RetroScreenV2 projectId={1} />);
    await findByText(/좋은 한 주였다/);
    expect(queryByRole("button", { name: /Notion 으로/ })).toBeNull();
    expect(fx.calls.export).toHaveLength(0);
  });

  it("토큰이 있으면 버튼이 보이고, 클릭 → notion_export(제목·본문) → open_url", async () => {
    fx.hasToken = true;
    const { findByText, findByRole } = render(<RetroScreenV2 projectId={1} />);
    await findByText(/좋은 한 주였다/);
    fireEvent.click(await findByRole("button", { name: "Notion 으로" }));

    await waitFor(() => expect(fx.calls.export).toHaveLength(1));
    // projectId 가 첫 인자 — 백엔드 redact 심층 방어 계약 (2026-07-20 리뷰).
    const [pid, title, markdown] = fx.calls.export[0] as [number, string, string];
    expect(pid).toBe(1);
    expect(title).toBe("회고 7/14–7/20");
    expect(markdown).toContain("좋은 한 주였다");
    await waitFor(() => expect(fx.calls.openUrl).toHaveLength(1));
    expect(fx.calls.openUrl[0]).toEqual(["https://www.notion.so/team/page-abc"]);
  });
});

describe("NotionSection 설정 (PR-CI7)", () => {
  it("검증 성공 후에만 키체인(secret_set)에 저장한다", async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <NotionSection onError={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText(/internal integration token/), {
      target: { value: " ntn_abc123 " },
    });
    fireEvent.click(getByRole("button", { name: "검증 후 저장" }));

    await waitFor(() => expect(fx.calls.verify).toHaveLength(1));
    expect(fx.calls.verify[0]).toEqual(["ntn_abc123"]);
    await waitFor(() => expect(fx.calls.secretSet).toHaveLength(1));
    expect(fx.calls.secretSet[0]).toEqual(["notion_api_key", "ntn_abc123"]);
    await findByText(/연결됨/);
  });

  it("검증 실패면 아무 데도 저장하지 않고 onError 로 보고한다", async () => {
    fx.verifyOk = false;
    const errors: (string | null)[] = [];
    const { getByPlaceholderText, getByRole } = render(
      <NotionSection onError={(m) => errors.push(m)} />,
    );
    fireEvent.change(getByPlaceholderText(/internal integration token/), {
      target: { value: "bad" },
    });
    fireEvent.click(getByRole("button", { name: "검증 후 저장" }));

    await waitFor(() => expect(errors.some((e) => e?.includes("검증 실패"))).toBe(true));
    expect(fx.calls.secretSet).toHaveLength(0);
  });

  it("부모 페이지 저장은 notion_set_parent 로 정규화 왕복한다", async () => {
    const { getByPlaceholderText, getByRole } = render(<NotionSection onError={() => {}} />);
    const input = getByPlaceholderText("https://www.notion.so/…") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://www.notion.so/acme/회고-1234567890abcdef1234567890abcdef" },
    });
    fireEvent.click(getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fx.calls.setParent).toHaveLength(1));
    await waitFor(() =>
      expect(input.value).toBe("12345678-90ab-cdef-1234-567890abcdef"),
    );
  });
});
