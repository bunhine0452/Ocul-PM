/**
 * 화면 여럿을 한 시험 파일에서 (11-15 합류) — 화면마다 따로 있는 가짜 백엔드(`todayFixture` · `journalHarness` ·
 * `plannerHarness` · `helpers/diffFx`)를 지금 그리는 화면(`mux.screen`)에 따라 고른다. `vi.mock` 은 파일마다 한
 * 모듈에 한 번이라, 「오늘에서 누르면 일지가 그렇게 선다」 처럼 화면을 건너는 시험이나 세 화면에 같은 키를 보내는
 * 시험이 가짜 둘 이상을 함께 물려면 이렇게 갈아 끼운다.
 *
 *   vi.mock("@/lib/bindings", async (orig) => (await import("./screenMux")).muxBindings(await orig()));
 *   vi.mock("@/api/oculpm", async (orig) => (await import("./screenMux")).muxOculpm(await orig()));
 *   vi.mock("@/api/plan", async (orig) => (await import("./screenMux")).muxPlan(await orig()));
 *
 * 이 파일은 앱 모듈을 값으로 들이지 않는다 — `vi.mock` 공장 안에서 들이므로(들이면 공장이 자기 자신을 기다린다).
 */
export type Screen = "today" | "journal" | "planner" | "diff";

/** 지금 그리는 화면 — 시험이 그리기 전에 바꾼다. */
export const mux: { screen: Screen } = { screen: "journal" };

type Backend = { commands: object; events: object };

/** 명령 · 사건은 부르는 순간의 화면 것으로 — 화면은 `commands.x(...)` 를 그때그때 읽는다. */
export async function muxBindings(orig: typeof import("@/lib/bindings")) {
  const backends: Record<Screen, Backend> = {
    today: (await import("./todayFixture")).bindingsMock(),
    journal: (await import("./journalHarness")).bindingsModule(orig),
    planner: (await import("./plannerHarness")).plannerBindings(),
    diff: (await import("./helpers/diffFx")).bindingsMock(),
  };
  const part = (name: keyof Backend) =>
    new Proxy({}, { get: (_t, prop) => Reflect.get(backends[mux.screen][name], prop) });
  return { ...orig, commands: part("commands"), events: part("events") };
}

/** 일지 화면은 `oculpmApi` 를 통째로 가짜로 쓴다(`journalHarness`) — 나머지 화면은 진짜가 가짜 명령을 부른다. */
export async function muxOculpm(real: typeof import("@/api/oculpm")) {
  const journal = (await import("./journalHarness")).oculpmModule().oculpmApi as Record<PropertyKey, unknown>;
  const oculpmApi = new Proxy(real.oculpmApi, {
    get: (target, prop) => (mux.screen === "journal" && prop in journal ? journal[prop] : Reflect.get(target, prop)),
  });
  return { ...real, oculpmApi };
}

/** 일지 화면의 계획 고리(`planApi.journalLinks`)만 가짜 — 계획 화면은 진짜가 가짜 명령을 부른다. */
export async function muxPlan(real: typeof import("@/api/plan")) {
  const journal = (await import("./journalHarness")).planModule().planApi as Record<PropertyKey, unknown>;
  const planApi = new Proxy(real.planApi, {
    get: (target, prop) => (mux.screen === "journal" && prop in journal ? journal[prop] : Reflect.get(target, prop)),
  });
  return { ...real, planApi };
}
