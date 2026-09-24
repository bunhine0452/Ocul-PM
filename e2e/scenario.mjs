// 시나리오 — 사용자가 처음 앱을 켜서 프로젝트를 들이고, 화면을 한 바퀴 돌고,
// 터미널을 쓰고, 에이전트가 일지를 쓰는 것까지. 각 단계는 스크린샷을 남긴다.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { IS_WIN } from "./lib/env.mjs";
import { composeHangul, connectCdp } from "./lib/ime.mjs";
import { connectApp } from "./lib/launch.mjs";
import { callMcpTool } from "./lib/mcp.mjs";
import {
  clickCss,
  installProbes,
  navigateTo,
  screenState,
  sidebarLabels,
  sleep,
  stubFolderPicker,
  waitFor,
  waitScreenReady,
} from "./lib/page.mjs";
import {
  HUMAN_KEY_MS,
  focusTerminal,
  pasteText,
  recordInput,
  takeInput,
  typeText,
  waitBuffer,
  waitLine,
} from "./lib/terminal.mjs";
import { resizeViewport } from "./lib/window.mjs";

const pollFs = async (path, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(250);
  }
  return false;
};

export async function runScenario(ctx) {
  const { wd, report, nav, ws, os, app, dict, mcpBin } = ctx;
  const crashTitles = [dict.ko("crash.title"), dict.en("crash.title"), dict.ko("term.crashTitle"), dict.en("term.crashTitle")];
  const fixture = ws.dirs.fixture;

  await report.step("기동 — 세션 생성 · 첫 화면", async (rec) => {
    ctx.session = await connectApp({ wd, app, ws, outDir: report.outDir, rec });
    await wd.setTimeouts({ script: 60_000, pageLoad: 120_000, implicit: 0 });
    // 메뉴바 팝오버(`?tray=1`)도 웹뷰다 — 드라이버가 그쪽을 잡았으면 본 창으로.
    const handles = await wd.req("GET", wd.s("/window/handles"));
    rec.notes.push(`웹뷰 창 ${handles.length}개`);
    const isTray = () => wd.execute("return /[?&]tray=1/.test(location.search);");
    for (const handle of handles) {
      if (!(await isTray())) break;
      await wd.req("POST", wd.s("/window"), { handle });
    }
    await waitFor(wd, "return document.readyState === 'complete' && !!document.querySelector('#root > *');", [], {
      timeout: 90_000,
      desc: "웹뷰 문서 로드",
    });
    await installProbes(wd);
    const wizard = await waitFor(wd, "return document.querySelector('.wz-scrim') ? 'wizard' : null;", [], {
      timeout: 60_000,
      desc: "첫 실행 마법사(빈 데이터 폴더)",
    });
    rec.notes.push(`첫 화면: ${wizard}`, `드라이버 브라우저: ${wd.capabilities.browserName ?? "?"} ${wd.capabilities.browserVersion ?? ""}`);
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "start-wizard", caption: "시작 탭 + 첫 실행 마법사 (언어)" });
  }, { critical: true });

  await report.step("첫 실행 마법사 → 픽스처 프로젝트 추가 (.oculpm 초기화)", async (rec) => {
    await clickCss(wd, ".wz-choice", 1); // 언어: 한국어 (시스템·한국어·English 순)
    await waitFor(wd, "const c = document.querySelectorAll('.wz-choice')[1]; return c && c.getAttribute('aria-checked') === 'true';", [], { desc: "한국어 선택" });
    await clickCss(wd, ".wz-primary");
    await waitFor(wd, "return !!document.querySelector('.wz-accents');", [], { desc: "모양 단계" });
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "wizard-look", caption: "마법사 — 모양" });
    await clickCss(wd, ".wz-primary");
    await waitFor(wd, "return !!document.querySelector('.wz-bigcard');", [], { desc: "프로젝트 단계" });
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "wizard-project", caption: "마법사 — 프로젝트" });
    await stubFolderPicker(wd, fixture);
    await clickCss(wd, ".wz-bigcard", 0);
    const title = await waitFor(wd, "const h = document.querySelector('.wz-list') && document.querySelector('.wz-title'); return h ? h.innerText : null;", [], {
      timeout: 30_000,
      desc: "마무리 판(create_project)",
    });
    rec.notes.push(`마무리 판 제목: ${title}`);
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "wizard-ready", caption: "마법사 — 프로젝트를 들였다" });
    await clickCss(wd, ".wz-primary");
    await waitFor(wd, "return !!document.querySelector('nav.sidebar .side-nav-scroll .nav-item');", [], { timeout: 60_000, desc: "프로젝트 셸(사이드바)" });
    await waitScreenReady(wd, 60_000);
    if (!(await pollFs(join(fixture, ".oculpm"), 60_000))) throw new Error(".oculpm/ 이 60초 안에 안 생겼다 (oculpmInit)");
    rec.notes.push(".oculpm/ 생성 확인");
    await sleep(1500);
    const state = await screenState(wd, crashTitles);
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "project-opened", caption: "프로젝트를 연 직후 (오늘 현황)", state, ok: state.crashes.length === 0 });
  }, { critical: true });

  await report.step("프로젝트 이름 = 폴더 이름 (e2e-fixture)", async (rec) => {
    const name = await wd.execute("const n = document.querySelector('nav.sidebar .proj-name'); return n ? n.innerText.trim() : null;");
    rec.notes.push(`사이드바 프로젝트 이름: ${JSON.stringify(name)}`);
    if (name !== "e2e-fixture") throw new Error(`프로젝트 이름이 ${JSON.stringify(name)} — 폴더 이름(e2e-fixture)이 아니다`);
  });

  await report.step("navRegistry 대조 — 사이드바 행 수", async (rec) => {
    const labels = await sidebarLabels(wd);
    rec.notes.push(`사이드바 ${labels.length}행: ${labels.join(" · ")}`, `navRegistry 행 ${nav.rows.length} · 화면 ${nav.destinations.length}`);
    if (labels.length !== nav.rows.length) throw new Error(`사이드바 ${labels.length}행 ≠ navRegistry ${nav.rows.length}행`);
  });

  const tour = async (phase, key, t) => {
    let i = 0;
    for (const dest of nav.destinations) {
      i += 1;
      const n = String(i).padStart(2, "0");
      await report.step(`${phase} · ${n} ${t(dest.labelKey)} (${dest.id})`, async (rec) => {
        await navigateTo(wd, dest, t);
        let readyErr = null;
        try {
          await waitScreenReady(wd);
        } catch (e) {
          readyErr = e.message;
        }
        await sleep(1200); // 진입 애니메이션·지연 데이터가 가라앉게
        const state = await screenState(wd, crashTitles);
        const ok = !readyErr && state.crashes.length === 0;
        await report.shot(wd, { phase, key, screen: `${n}-${dest.id}`, caption: `${t(dest.labelKey)} (${dest.id})`, state, ok });
        if (state.toasts.length) rec.notes.push(`토스트: ${state.toasts.join(" | ")}`);
        if (state.errors.length) rec.notes.push(`페이지 오류: ${state.errors.join(" | ")}`);
        if (state.crashes.length) throw new Error(`에러 경계: ${state.crashes.join(" | ")}`);
        if (readyErr) throw new Error(readyErr);
      });
    }
  };

  const sized = async (label, w, h) => {
    await report.step(`창 크기 ${label} (${w}×${h})`, async (rec) => {
      const r = await resizeViewport(wd, w, h);
      rec.notes.push(...r.notes);
      if (!r.reached) rec.notes.push(`목표에 못 미침 — 실제 ${r.inner.join("×")} 로 찍는다`);
    });
  };

  await sized("한국어 넓은 폭", 1440, 900);
  await tour("02 화면 · 한국어 1440", "ko-1440", dict.ko);

  const terminal = nav.destinations.find((d) => d.id === "terminal");
  await report.step("터미널 — echo 한글-ok 왕복 (xterm 버퍼)", async (rec) => {
    let ok = false;
    try {
      await navigateTo(wd, terminal, dict.ko);
      await waitFor(wd, "return !!document.querySelector('.content-main .xterm');", [], { timeout: 30_000, desc: "xterm 마운트" });
      const prompt = await waitBuffer(wd, 45_000);
      rec.notes.push(`xterm ${prompt.count}개 · 프롬프트: ${JSON.stringify(prompt.lines.filter((l) => l.trim()).slice(-1)[0] ?? "")}`);
      const el = await focusTerminal(wd);
      await recordInput(wd);
      // ASCII 는 WebDriver 키(실제 키 이벤트), 한글은 붙여넣기 — 키 합성은 입력기를
      // 거치지 않아 한글을 못 싣는다. 입력기 조합 경로는 다음 단계(Windows CDP)가 본다.
      // 사람 속도로 친다 — 이 단계가 보는 것은 한글 왕복이다. 빠른 연타의 순서
      // 보존은 뒤의 단계가 따로 본다.
      const how = await typeText(wd, el, "echo ", { paceMs: HUMAN_KEY_MS });
      const pasted = await pasteText(wd, "한글");
      await sleep(HUMAN_KEY_MS);
      await typeText(wd, el, "-ok\uE007", { paceMs: HUMAN_KEY_MS });
      rec.notes.push(`입력: 키=${how} · 한글=${pasted}`);
      try {
        const got = await waitLine(wd, "한글-ok", 30_000);
        rec.notes.push(`버퍼 끝: ${got.lines.slice(-4).map((l) => JSON.stringify(l)).join(" / ")}`);
      } finally {
        rec.notes.push(`입력칸 이벤트: ${(await takeInput(wd)).slice(0, 900)}`);
      }
      ok = true;
    } finally {
      await report.shot(wd, { phase: "03 터미널", key: "terminal", screen: "echo-hangul", caption: "터미널 — echo 한글-ok", ok });
    }
  });

  await report.step("IME 흉내 (Windows CDP) — 한글 조합이 정확히 한 번", async (rec) => {
    if (!IS_WIN) {
      rec.status = "skip";
      rec.notes.push("WebKitGTK 에는 CDP 가 없다 — Linux 실제 입력기(fcitx·ibus)는 #w5-eyes 원장 몫 (D8)");
      return;
    }
    const cdp = await connectCdp(wd, ctx.session?.debuggerAddress);
    rec.notes.push(`CDP 경로: ${cdp.via}`, ...cdp.tried.map((t) => `시도: ${t}`));
    let ok = false;
    try {
      const el = await focusTerminal(wd);
      await typeText(wd, el, "echo ime-", { paceMs: HUMAN_KEY_MS });
      await recordInput(wd);
      const trace = await composeHangul(cdp);
      rec.notes.push(`CDP 조합 순서: ${trace.join(" → ")}`);
      rec.notes.push(`입력칸 이벤트: ${(await takeInput(wd)).slice(0, 1500)}`);
      await typeText(wd, el, "-end\uE007", { paceMs: HUMAN_KEY_MS });
      // 중복(한한글·한글글)·낱자 누출(ㅎ하한)이면 이 줄이 정확히 나오지 않는다 —
      // 실패 메시지에 버퍼 끝 줄들이 실린다.
      const got = await waitLine(wd, "ime-한글-end", 30_000);
      rec.notes.push(`ime 줄: ${got.lines.filter((l) => l.includes("ime-")).map((l) => JSON.stringify(l.trim())).join(" / ")}`);
      ok = true;
    } finally {
      cdp.close();
      await report.shot(wd, { phase: "03 터미널", key: "terminal", screen: "ime-cdp", caption: "터미널 — CDP 한글 조합 (ime-한글-end)", ok });
    }
  });

  await report.step("터미널 — 빠른 연타의 입력 순서 보존", async (rec) => {
    let ok = false;
    try {
      const el = await focusTerminal(wd);
      await recordInput(wd);
      // 한 번의 Send Keys — 드라이버가 키를 몇 ms 간격으로 쏟아낸다(빠른 타자·키 반복과
      // 같은 부류). 키마다 따로 가는 쓰기 IPC 가 순서를 지키는지 본다.
      await typeText(wd, el, "echo order-0123456789\uE007");
      try {
        const got = await waitLine(wd, "order-0123456789", 20_000);
        rec.notes.push(`버퍼 끝: ${got.lines.slice(-3).map((l) => JSON.stringify(l)).join(" / ")}`);
        ok = true;
      } finally {
        rec.notes.push(`입력칸 이벤트(DOM 순서): ${(await takeInput(wd)).slice(0, 600)}`);
      }
    } finally {
      await report.shot(wd, { phase: "03 터미널", key: "terminal", screen: "burst-order", caption: "터미널 — 빠른 연타 (echo order-0123456789)", ok });
      // 순서가 깨졌으면 줄 끝이 다음 프롬프트로 샌다 — ^C 로 비워 둔다.
      try {
        await typeText(wd, await focusTerminal(wd), "\uE009c\uE000");
      } catch {
        /* 정리 실패는 이 단계의 판정과 무관하다 */
      }
    }
  });

  const journalTitle = `E2E 사이드카 일지 (${os})`;
  await report.step("사이드카 oculpm-mcp journal_write → 일지 화면 반영", async (rec) => {
    const { server, result } = await callMcpTool({
      bin: mcpBin,
      root: fixture,
      env: ws.env,
      logFile: join(report.outDir, "oculpm-mcp.stderr.log"),
      name: "journal_write",
      args: {
        type: "chore",
        slug: "e2e-sidecar-roundtrip",
        title: journalTitle,
        body_markdown: "끝단 테스트 하네스가 사이드카로 쓴 일지.\n\n## 검증\n- 하네스가 작업 일지 화면에서 이 제목을 찾는다\n",
        tags: ["e2e"],
        agent_id: "e2e-harness",
      },
    });
    rec.notes.push(`서버: ${server?.name ?? "?"} ${server?.version ?? ""}`);
    if (result?.isError) throw new Error(`journal_write isError: ${JSON.stringify(result.content).slice(0, 400)}`);
    const rel = result?.structuredContent?.path;
    rec.notes.push(`일지: ${rel}`);
    if (!rel || !existsSync(join(fixture, rel))) throw new Error(`일지 파일이 디스크에 없다: ${rel}`);
    await navigateTo(wd, nav.destinations.find((d) => d.id === "journal"), dict.ko);
    let ok = false;
    try {
      await waitFor(wd, "const m = document.querySelector('.content-main'); return !!m && m.innerText.includes(arguments[0]);", [journalTitle], {
        timeout: 60_000,
        interval: 500,
        desc: "일지 화면에 새 일지 제목",
      });
      ok = true;
    } finally {
      const state = await screenState(wd, crashTitles);
      await report.shot(wd, { phase: "04 일지", key: "journal", screen: "journal-mcp", caption: "사이드카가 쓴 일지가 일지 화면에", state, ok });
    }
  });

  await report.step("영어 모드 전환 (설정 → 모양 → English)", async () => {
    await clickCss(wd, "nav.sidebar .side-foot .nav-util--icon", 1);
    await waitFor(wd, "return document.querySelectorAll('.cfg-choices .cfg-choice').length >= 3;", [], { desc: "설정 — 언어 선택" });
    await clickCss(wd, ".cfg-choices .cfg-choice", 2);
    await waitFor(wd, "return !!document.querySelector('nav.sidebar') && document.querySelector('nav.sidebar').innerText.includes(arguments[0]);", [dict.en("nav.today")], {
      desc: "사이드바가 영어로",
    });
    await sleep(800);
    await report.shot(wd, { phase: "05 영어", key: "en", screen: "settings-en", caption: "설정 — English 로 바꾼 직후" });
  });

  await sized("영어 넓은 폭", 1440, 900);
  await tour("06 화면 · English 1440", "en-1440", dict.en);
  await sized("영어 좁은 폭(최소 폭)", 960, 700);
  await tour("07 화면 · English 960", "en-960", dict.en);
}
