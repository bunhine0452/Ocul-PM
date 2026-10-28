// 시나리오 — 사용자가 처음 앱을 켜서 프로젝트를 들이고, 화면을 한 바퀴 돌고,
// 에이전트가 일지를 쓰는 것까지. 각 단계는 스크린샷을 남긴다. (내장 터미널 단계는
// 터미널과 함께 2026-10-28 에 걷었다.)

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
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
  waitNoToasts,
  waitScreenReady,
} from "./lib/page.mjs";
import { resizeViewport } from "./lib/window.mjs";

const pollFs = async (path, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(250);
  }
  return false;
};

/**
 * 본 창(트레이 팝오버가 아니고 주소가 실린 창)으로 옮겨 간다. 창 목록을 돌며 각 창의 주소를
 * 읽고, 없으면 잠깐 뒤 목록부터 다시 — 창이 아직 안 생겼거나 about:blank 일 수 있다.
 */
async function pickMainWindow(wd, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  for (let rounds = 1; ; rounds++) {
    const handles = await wd.req("GET", wd.s("/window/handles"));
    for (const handle of handles) {
      await wd.req("POST", wd.s("/window"), { handle });
      let href = "";
      try {
        href = await wd.execute("return location.href;");
      } catch (e) {
        href = `(읽기 실패: ${String(e.message).slice(0, 60)})`;
      }
      const loaded = /^(https?|tauri):/.test(href);
      if (loaded && !/[?&]tray=1/.test(href)) return { href, handles: handles.length, rounds, seen: [...seen] };
      seen.add(href);
    }
    if (Date.now() > deadline) {
      throw new Error(`본 창을 못 찾았다 (${timeoutMs / 1000}초, 창 ${handles.length}개: ${[...seen].join(" | ")})`);
    }
    await sleep(500);
  }
}

export async function runScenario(ctx) {
  const { wd, report, nav, ws, os, app, dict, mcpBin } = ctx;
  const crashTitles = [dict.ko("crash.title"), dict.en("crash.title"), dict.ko("term.crashTitle"), dict.en("term.crashTitle")];
  const fixture = ws.dirs.fixture;

  await report.step("기동 — 세션 생성 · 첫 화면", async (rec) => {
    ctx.session = await connectApp({ wd, app, ws, outDir: report.outDir, rec });
    await wd.setTimeouts({ script: 60_000, pageLoad: 120_000, implicit: 0 });
    // 메뉴바 팝오버(`?tray=1`)도 웹뷰다 — 본 창을 골라 붙는다. 주소가 아직 안 실린 창
    // (about:blank)은 트레이인지 알 수 없으니 실릴 때까지 기다렸다 다시 고른다. 예전엔
    // 지금 창의 location.search 만 봐서, attach 순간 주소를 싣기 전의 트레이를 잡으면 "트레이
    // 아님" 으로 읽고 그대로 머물렀다 — 문서 로드(#root)는 통과하고 마법사만 60초 뒤 null
    // (Windows E2E 간헐 실패 #e2e-win-devtools-flake, PR #47 run 36063711206).
    const pick = await pickMainWindow(wd, 60_000);
    rec.notes.push(`웹뷰 창 ${pick.handles}개 · 고른 창 ${pick.href} · 시도 ${pick.rounds}회${pick.seen.length ? ` · 지나친 창: ${pick.seen.join(" | ")}` : ""}`);
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
    await report.shot(wd, { phase: "01 기동", key: "boot", screen: "project-opened", caption: "프로젝트를 연 직후 (오늘 현황)", state, ok: state.crashes.length === 0 && state.csp.length === 0 });
    // 웹뷰 CSP 위반은 화면이 조용히 비는 것으로만 보인다 — 여기서 이름을 붙여 떨어뜨린다.
    if (state.csp.length) throw new Error(`CSP 위반: ${state.csp.join(" | ")}`);
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
        const ok = !readyErr && state.crashes.length === 0 && state.csp.length === 0;
        await report.shot(wd, { phase, key, screen: `${n}-${dest.id}`, caption: `${t(dest.labelKey)} (${dest.id})`, state, ok });
        if (state.toasts.length) rec.notes.push(`토스트: ${state.toasts.join(" | ")}`);
        if (state.errors.length) rec.notes.push(`페이지 오류: ${state.errors.join(" | ")}`);
        if (state.crashes.length) throw new Error(`에러 경계: ${state.crashes.join(" | ")}`);
        if (state.csp.length) throw new Error(`CSP 위반: ${state.csp.join(" | ")}`);
        if (readyErr) throw new Error(readyErr);
      });
    }
  };

  const sized = async (label, w, h) => {
    await report.step(`창 크기 ${label} (${w}×${h})`, async (rec) => {
      const r = await resizeViewport(wd, w, h, { processName: basename(app).replace(/\.exe$/i, "") });
      rec.notes.push(...r.notes);
      if (!r.reached) rec.notes.push(`목표에 못 미침 — 실제 ${r.inner.join("×")} 로 찍는다`);
    });
  };

  await sized("한국어 넓은 폭", 1440, 900);
  await tour("02 화면 · 한국어 1440", "ko-1440", dict.ko);

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
      if (state.csp.length) rec.notes.push(`CSP 위반: ${state.csp.join(" | ")}`);
      await report.shot(wd, { phase: "04 일지", key: "journal", screen: "journal-mcp", caption: "사이드카가 쓴 일지가 일지 화면에", state, ok: ok && state.csp.length === 0 });
    }
  });

  await report.step("영어 모드 전환 (설정 → 표시 → English)", async (rec) => {
    await clickCss(wd, "nav.sidebar .side-foot .nav-util--icon", 1);
    await waitFor(wd, "return document.querySelectorAll('.cfg-choices .cfg-choice').length >= 3;", [], { desc: "설정 — 언어 선택" });
    // 직전 단계(사이드카 일지)의 「열기」 토스트가 오른쪽 아래에 15초 남는다 — 언어 버튼이
    // 그 자리까지 내려오면 클릭이 가로막힌다 (v3.17.0 run, Windows·Linux 27건 연쇄 실패).
    const t0 = Date.now();
    await waitNoToasts(wd);
    rec.notes.push(`토스트 소거 대기 ${Date.now() - t0}ms`);
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

  // 화면 순회 밖(터미널·일지 단계)에서 난 위반까지 — 남은 것을 마지막에 턴다.
  await report.step("웹뷰 CSP 위반 없음 (남은 것)", async (rec) => {
    const left = await wd.execute("return window.__oculpmCsp ? window.__oculpmCsp.splice(0) : null;");
    if (left === null) throw new Error("CSP 감시가 설치되지 않았다 (window.__oculpmCsp 없음)");
    rec.notes.push(`남은 위반 ${left.length}건`);
    if (left.length) throw new Error(`CSP 위반: ${left.join(" | ")}`);
    // 위반 0건은 "정책이 아예 안 실렸다" 와도 같은 모양이다 — 막혀야 할 것을 하나 일부러
    // 넣어 정책이 실제로 걸려 있는지 본다. `.invalid` 는 예약 TLD 라 막히지 않아도 어디에도
    // 닿지 않는다.
    await wd.execute(`const img = document.createElement('img');
      img.id = 'csp-probe'; img.src = 'https://csp-probe.invalid/p.png';
      document.body.appendChild(img); return true;`);
    let probe = [];
    for (let i = 0; i < 20 && probe.length === 0; i += 1) {
      await sleep(150);
      probe = await wd.execute(
        "const all = window.__oculpmCsp ? window.__oculpmCsp.splice(0) : []; return all.filter((l) => l.includes('csp-probe.invalid'));",
      );
    }
    await wd.execute("const p = document.getElementById('csp-probe'); if (p) p.remove(); return true;");
    rec.notes.push(`탐침: ${probe.join(" | ") || "위반 없음"}`);
    if (!probe.length) throw new Error("CSP 가 걸려 있지 않다 — 원격 이미지 탐침이 막히지 않았다");
  });
}
