import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── PR-CI7 — Notion 설정: 검증→키체인 저장 계약 ────────────────────────────
//
// 토큰은 **검증 성공 후에만** secret_set(키체인)으로 저장되고, 검증 실패 시
// 어디에도 저장되지 않는다.
//
// 회고 화면이 지고 있던 "Notion 으로" 내보내기 단언은 그 화면과 함께 사라졌다
// (2026-09-08) — `notion_export` 커맨드 자체는 남아 있고 트리거만 없다.

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

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
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

import { NotionSection } from "@/features/settings/SettingsPanel";

beforeEach(() => {
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
  cleanup();
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

    await waitFor(() => expect(errors.some((e) => e?.includes("확인하지 못했습니다"))).toBe(true));
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
