/**
 * 찍기 계획 — 화면 × 테마 × 크기 × 상태. shots.mjs 가 부른다.
 *
 * 열 때 쓰는 일지 · 계획은 픽스처에서 고른다(저장소가 바뀌어도 깨지지 않게 이름을 박지 않는다).
 * `--only 05-diff,70-` 처럼 이름 조각으로 일부만 찍을 수 있다.
 */
import fs from "node:fs";
import path from "node:path";

const audit = fs.readFileSync(path.join(import.meta.dirname, "audit.js"), "utf8");

/** 셸이 늦게 붙는 첫 로드를 견디게 세 번 쏜다(같은 화면이면 아무 일도 안 한다). */
const view = (v) =>
  `(async () => { for (let i = 0; i < 3; i++) { window.dispatchEvent(new CustomEvent("oculpm:set-view", {detail: ${JSON.stringify(v)}})); ` +
  `await new Promise((r) => setTimeout(r, 500)); } return "ok"; })()`;

const entity = (kind, id) =>
  `window.dispatchEvent(new CustomEvent("oculpm:open-entity", {detail: {kind: ${JSON.stringify(kind)}, id: ${JSON.stringify(id)}}})); "ok"`;

/** 글자가 든 첫 단추를 누른다 — 못 찾으면 'no-button' 을 돌려 shots.mjs 가 보고서에 적는다. */
const clickText = (t) =>
  `(() => { const b = [...document.querySelectorAll('button,[role=button],summary')].find((x) => x.innerText.includes(${JSON.stringify(t)})); ` +
  `if (!b) return 'no-button'; b.click(); return 'clicked'; })()`;

export function buildPlan({ fx, outDir, base, only }) {
  const latest = fx.workdays[fx.workdays.length - 1];
  const withProof = fx.journals.find((j) => j.workday === latest && j.evidence === 2 && j.files_count > 0) ?? fx.journals[0];
  const noEvidence = fx.journals.find((j) => j.evidence === 0) ?? fx.journals.find((j) => j.evidence < 2) ?? fx.journals[0];
  const plan = fx.plans[0];
  const JOURNAL = withProof?.relative_path;
  const NOEVIDENCE = noEvidence?.relative_path;
  const PLAN = plan?.summary.plan_id;

  const SCREENS = {
    start: [],
    today: [],
    journal: [view("journal"), { wait: 900 }, ...(JOURNAL ? [entity("journal", JOURNAL), { wait: 1200 }] : [])],
    planner: [view("planner"), { wait: 900 }, ...(PLAN ? [entity("plan", PLAN), { wait: 1200 }] : [])],
    diff: [view("diff"), { wait: 1500 }],
    terminal: [view("terminal"), { wait: 2500 }],
    settings: [view("settings"), { wait: 1500 }],
  };

  let shots = [];
  const add = (name, q, screen, { w = 1280, h = 800, dark = false, steps, load = 3500 } = {}) => {
    shots.push({ name, q, w, h, dark, load, steps: [...(steps ?? SCREENS[screen] ?? [])], dump: audit });
  };

  // 1280 × 밝게/어둡게
  for (const theme of ["light", "dark"]) {
    const dark = theme === "dark";
    add(`01-start-${theme}`, `start=1&theme=${theme}`, "start", { dark });
    Object.keys(SCREENS)
      .filter((s) => s !== "start")
      .forEach((s, i) => add(`${String(i + 2).padStart(2, "0")}-${s}-${theme}`, `theme=${theme}`, s, { dark }));
  }

  // 좁은 창 760x700
  for (const s of ["today", "journal", "planner", "diff", "terminal", "settings"]) add(`20-narrow-${s}-light`, "theme=light", s, { w: 760, h: 700 });
  add("20-narrow-start-light", "start=1&theme=light", "start", { w: 760, h: 700 });
  add("21-narrow-today-dark", "theme=dark", "today", { w: 760, h: 700, dark: true });
  add("21-narrow-journal-dark", "theme=dark", "journal", { w: 760, h: 700, dark: true });

  // 빈 상태
  for (const s of ["today", "journal", "planner", "diff"]) add(`30-empty-${s}-light`, "empty=1&theme=light", s);
  add("30-empty-today-dark", "empty=1&theme=dark", "today", { dark: true });

  // 영어
  for (const s of ["today", "journal", "planner", "settings"]) add(`40-en-${s}-light`, "lang=en&theme=light", s);
  add("40-en-start-light", "lang=en&start=1&theme=light", "start");
  add("41-en-narrow-today-dark", "lang=en&theme=dark", "today", { w: 760, h: 700, dark: true });

  // 예외가 있는 날(Claude 기다림 · 질문 · 판정 실패)
  add("50-exceptions-today-light", "wait=1&fail=1&theme=light", "today");
  add("50-exceptions-today-dark", "wait=1&fail=1&theme=dark", "today", { dark: true });
  add("51-exceptions-planner-light", "wait=1&fail=1&theme=light", "planner");

  // ⌘K 팔레트
  add("60-palette-light", "theme=light", undefined, { steps: [{ key: "k", code: "KeyK", vk: 75, mod: 4 }, { wait: 800 }] });

  // 증거 없는 일지 · 펼친 오늘 · 「검증 없는 것만」 · 시간순
  add("70-journal-noevidence-light", "theme=light", undefined, {
    steps: [view("journal"), { wait: 900 }, ...(NOEVIDENCE ? [entity("journal", NOEVIDENCE), { wait: 1200 }] : [])],
  });
  add("71-today-expanded-light", "theme=light", undefined, {
    steps: [...(plan ? [clickText(plan.summary.title.slice(0, 8))] : []), { wait: 800 }],
  });
  add("72-journal-unverified-only-light", "theme=light", undefined, { steps: [view("journal"), { wait: 900 }, clickText("검증 없는 것만"), { wait: 1000 }] });
  add("73-today-bytime-dark", "theme=dark", undefined, { dark: true, steps: [clickText("시간순"), { wait: 800 }] });

  if (only) {
    const parts = only.split(",").filter(Boolean);
    shots = shots.filter((x) => parts.some((o) => x.name.includes(o)));
  }
  return { base, outDir, shots };
}
