import { describe, expect, it } from "vitest";
import type { AcpCommand } from "@/lib/bindings";
import {
  applyCommand,
  filterCommands,
  findSlashQuery,
  withLocalCommands,
} from "@/features/chat/acpSlash";

// PR-ACP9 — `/` 슬래시 커맨드.

const cmd = (name: string, description = "", hint: string | null = null): AcpCommand => ({
  name,
  description,
  hint,
});

describe("findSlashQuery", () => {
  it("opens on a bare slash and tracks what follows", () => {
    expect(findSlashQuery("/")).toEqual({ query: "" });
    expect(findSlashQuery("/plug")).toEqual({ query: "plug" });
  });

  /** 문장 중간의 `and/or`, 경로의 `src/lib` 까지 잡으면 목록이 시도 때도 없이 뜬다. */
  it("only treats a slash at the very start as a command", () => {
    expect(findSlashQuery("say and/or")).toBeNull();
    expect(findSlashQuery("read src/lib")).toBeNull();
  });

  it("closes once arguments start", () => {
    expect(findSlashQuery("/plugin foo")).toBeNull();
  });
});

describe("filterCommands", () => {
  const all = [cmd("compact"), cmd("plugin"), cmd("clear", "clear the plugin cache")];

  it("returns everything for an empty query", () => {
    expect(filterCommands(all, "")).toHaveLength(3);
  });

  it("matches on name or description", () => {
    expect(filterCommands(all, "plugin").map((c) => c.name)).toEqual(["plugin", "clear"]);
  });

  /** 엔터는 첫 항목을 고른다 — 이름 접두 일치가 설명 일치보다 앞서야 한다. */
  it("ranks name-prefix matches above description matches", () => {
    expect(filterCommands(all, "plug")[0].name).toBe("plugin");
  });

  it("does not mutate the input list", () => {
    const before = [...all];
    filterCommands(all, "c");
    expect(all).toEqual(before);
  });
});

describe("applyCommand", () => {
  it("leaves a trailing space only when the command takes an argument", () => {
    expect(applyCommand(cmd("compact"))).toBe("/compact");
    expect(applyCommand(cmd("plugin", "", "name"))).toBe("/plugin ");
  });
});

describe("filterCommands — pinned commands", () => {
  const all = [cmd("zebra"), cmd("compact"), cmd("alpha"), cmd("usage"), cmd("plugin")];

  /** `/` 만 쳤을 때 알파벳순이면 자주 쓰는 것이 백 개 아래 묻힌다. */
  it("pins the common commands to the top for an empty query", () => {
    expect(filterCommands(all, "").slice(0, 3).map((c) => c.name)).toEqual([
      "usage",
      "compact",
      "plugin",
    ]);
  });

  it("keeps the adapter order among unpinned commands", () => {
    expect(filterCommands(all, "").slice(3).map((c) => c.name)).toEqual(["zebra", "alpha"]);
  });

  it("does not pin once the user starts typing", () => {
    expect(filterCommands(all, "alph")[0].name).toBe("alpha");
  });
});

describe("withLocalCommands", () => {
  const describe_ = (key: string) => `desc:${key}`;

  it("adds the app-handled commands the adapter never advertises", () => {
    const names = withLocalCommands([], describe_).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["usage", "clear", "continue", "remote-control"]),
    );
  });

  /** 어댑터가 언젠가 같은 이름을 주기 시작하면 그쪽이 진짜다 — 우리 설명이
      남으면 실제 동작과 다른 문장을 보여 주게 된다. */
  it("lets the adapter win when a name collides, without duplicating it", () => {
    const merged = withLocalCommands(
      [{ name: "continue", description: "from the adapter", hint: null }],
      describe_,
    );
    expect(merged.filter((c) => c.name === "continue")).toHaveLength(1);
    expect(merged[0].description).toBe("from the adapter");
  });
});
