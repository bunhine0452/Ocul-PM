import { describe, expect, it } from "vitest";
import { markSpoken, stabilizeHistory, type ActivityLedger } from "@/features/chat/acpHistory";

// 목록 순서 — 어댑터의 updated_at 은 "파일이 만져진 시각"이라 열어 보기만 해도
// 올라간다. 순서만큼은 우리가 아는 사실로 잡는다.

const at = (id: string, updated_at: string | null) => ({ id, title: id, updated_at });

describe("stabilizeHistory", () => {
  it("sorts newest first", () => {
    const ledger: ActivityLedger = new Map();
    const out = stabilizeHistory(
      [at("old", "2026-08-01T00:00:00Z"), at("new", "2026-08-14T00:00:00Z")],
      ledger,
    );
    expect(out.map((s) => s.id)).toEqual(["new", "old"]);
  });

  /** 핵심: 한 마디도 안 했는데 맨 위로 올라오던 것. */
  it("ignores a timestamp that moved after we first saw the session", () => {
    const ledger: ActivityLedger = new Map();
    stabilizeHistory([at("a", "2026-08-01T00:00:00Z"), at("b", "2026-08-10T00:00:00Z")], ledger);

    // 'a' 를 열어 보기만 해서 어댑터 쪽 시각이 튀었다.
    const out = stabilizeHistory(
      [at("a", "2026-08-14T09:00:00Z"), at("b", "2026-08-10T00:00:00Z")],
      ledger,
    );
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
    expect(out[1].updated_at).toBe("2026-08-01T00:00:00Z");
  });

  it("moves a session up once we actually spoke in it", () => {
    const ledger: ActivityLedger = new Map();
    stabilizeHistory([at("a", "2026-08-01T00:00:00Z"), at("b", "2026-08-10T00:00:00Z")], ledger);

    markSpoken(ledger, "a", "2026-08-15T00:00:00Z");

    const out = stabilizeHistory(
      [at("a", "2026-08-01T00:00:00Z"), at("b", "2026-08-10T00:00:00Z")],
      ledger,
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  /** 언제인지 모르는 것을 "가장 최근" 자리에 놓으면 첫 줄이 거짓말이 된다. */
  it("puts sessions with no timestamp last", () => {
    const ledger: ActivityLedger = new Map();
    const out = stabilizeHistory([at("unknown", null), at("dated", "2026-08-01T00:00:00Z")], ledger);
    expect(out.map((s) => s.id)).toEqual(["dated", "unknown"]);
  });

  it("does not mutate the input array", () => {
    const ledger: ActivityLedger = new Map();
    const input = [at("a", "2026-08-01T00:00:00Z"), at("b", "2026-08-10T00:00:00Z")];
    stabilizeHistory(input, ledger);
    expect(input.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("stabilizeHistory with tombstones", () => {
  /** session/delete 가 성공해도 어댑터 목록에는 잠깐 더 남는다 — 그래서 지운
      줄이 사라졌다가 다음 조회에 되살아났다. */
  it("hides sessions we already deleted", () => {
    const ledger: ActivityLedger = new Map();
    const out = stabilizeHistory(
      [at("gone", "2026-08-10T00:00:00Z"), at("kept", "2026-08-01T00:00:00Z")],
      ledger,
      new Set(["gone"]),
    );
    expect(out.map((s) => s.id)).toEqual(["kept"]);
  });

  it("behaves as before when nothing was deleted", () => {
    const ledger: ActivityLedger = new Map();
    const out = stabilizeHistory([at("a", "2026-08-01T00:00:00Z")], ledger, new Set());
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });
});
