import { beforeEach, describe, expect, it, vi } from "vitest";

// 회고 생성 버스의 단일 비행 계약.
//
// 2026-09-01 — 예전 가드는 `running` 이 있기만 하면 무엇이든 막았다. 창 하나 =
// 프로젝트 하나이던 시절엔 그게 "같은 회고를 두 번 만들지 마라" 와 같은 말이었지만,
// 크롬식 탭 이후로는 아니다: 프로젝트 B 에서 누른 생성이 A 의 생성 때문에 최대
// 3분(STALL_MS) 막히고, 화면엔 아무것도 안 도는데 "이미 생성 중" 만 떴다.
// 백엔드 `generate_retro` 는 전역 락 없이 `(project_id, range_key)` 행에만
// upsert 하므로, 막아야 할 진짜 위험은 **같은 키의 중복 생성**뿐이다.

const resolvers: Array<(v: unknown) => void> = [];

vi.mock("@/lib/bindings", () => ({
  commands: {
    generateRetro: () =>
      new Promise((resolve) => {
        resolvers.push(resolve as (v: unknown) => void);
      }),
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { info: () => {}, warning: () => {}, destructive: () => {} },
}));
vi.mock("@/i18n", () => ({ t: (k: string) => k }));

import {
  _resetRetroGen,
  consumeRetroGenDone,
  getRetroGenRunning,
  retroGenKey,
  startRetroGen,
} from "@/features/retro/retroGen";

const A = retroGenKey(1, "7d");
const B = retroGenKey(2, "7d");
const A30 = retroGenKey(1, "30d");

/** 화면이 넘기는 인자 그대로 — 키만 다르게. */
function start(projectId: number, rangeKey: string): boolean {
  return startRetroGen(projectId, "2026-08-01", "2026-09-01", rangeKey, "anthropic", "opus");
}

/** 대기 중인 백엔드 호출 하나를 성공으로 끝낸다. */
async function settle(index: number) {
  resolvers[index]?.({ status: "ok", data: { retro_md: "# 회고" } });
  // then/finally 체인이 돌게 한 틱 넘긴다.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resolvers.length = 0;
  _resetRetroGen();
});

describe("retroGen 단일 비행 — 키 단위", () => {
  it("같은 프로젝트·같은 기간을 두 번 시작하지 않는다", () => {
    expect(start(1, "7d")).toBe(true);
    expect(start(1, "7d")).toBe(false); // 진짜 위험 — 토큰 낭비 + 같은 행 경합
    expect(resolvers).toHaveLength(1);
  });

  it("다른 프로젝트는 서로를 막지 않는다", () => {
    expect(start(1, "7d")).toBe(true);
    expect(start(2, "7d")).toBe(true);

    expect(getRetroGenRunning(A)?.key).toBe(A);
    expect(getRetroGenRunning(B)?.key).toBe(B);
  });

  it("같은 프로젝트의 다른 기간도 막지 않는다", () => {
    expect(start(1, "7d")).toBe(true);
    expect(start(1, "30d")).toBe(true);
    expect(getRetroGenRunning(A30)?.key).toBe(A30);
  });

  it("한쪽이 끝나도 다른 쪽은 계속 돈다", async () => {
    start(1, "7d");
    start(2, "7d");

    await settle(0); // 프로젝트 1 완료

    expect(getRetroGenRunning(A)).toBeNull();
    expect(getRetroGenRunning(B)?.key).toBe(B);
  });

  it("완료 결과는 자기 키만 가져간다", async () => {
    start(1, "7d");
    start(2, "7d");
    await settle(1); // 프로젝트 2 완료

    expect(consumeRetroGenDone(A)).toBeNull(); // 남의 결과를 입양하지 않는다
    const mine = consumeRetroGenDone(B);
    expect(mine?.key).toBe(B);
    expect(consumeRetroGenDone(B)).toBeNull(); // 1회 소비
  });

  it("끝난 키는 다시 시작할 수 있다", async () => {
    start(1, "7d");
    await settle(0);
    expect(start(1, "7d")).toBe(true);
  });
});
