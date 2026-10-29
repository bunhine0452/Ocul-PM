// 페이지 쪽 도우미 — 웹뷰 안에서 도는 스크립트와 그것을 부르는 얇은 함수들.
//
// 원칙: 누르는 것은 **WebDriver 의 실제 클릭·키**로 한다 (React onClick 을 JS 로
// 부르면 포인터 경로를 건너뛴다). JS 는 "무엇을 누를지 찾기" 와 "상태 읽기" 에만.

import { elementId } from "./webdriver.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `script` 가 참을 돌려줄 때까지 폴링. 시간이 다 되면 마지막 값을 싣고 던진다. */
export async function waitFor(wd, script, args = [], { timeout = 20_000, interval = 250, desc = "조건" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await wd.execute(script, args);
      if (last) return last;
    } catch (e) {
      last = `execute 오류: ${e.message}`;
    }
    if (Date.now() > deadline) {
      throw new Error(`${desc} — ${timeout / 1000}초 안에 안 됐다 (마지막 값: ${JSON.stringify(last)?.slice(0, 300)})`);
    }
    await sleep(interval);
  }
}

/**
 * CSS 로 찾은 n 번째 **보이는** 요소를 실제 클릭.
 *
 * 누르기 전에 요소를 뷰포트 **가운데**로 스크롤한다. WebDriver 는 요소가 뷰포트 밖이면
 * 가장자리에 맞춰 스크롤하는데, 그러면 아래 가장자리에 걸린 요소가 오른쪽 아래의
 * 토스트와 겹쳐 `element click intercepted` 가 난다 — v3.17.0 릴리스 run 에서
 * 설정 「표시」 탭의 언어 버튼이 직전 단계의 「새 기록 … 열기」 토스트에 가려졌다.
 */
export async function clickCss(wd, css, index = 0, opts = {}) {
  const ref = await waitFor(
    wd,
    `const els = [...document.querySelectorAll(arguments[0])].filter(e => e.getClientRects().length > 0 && !e.disabled);
     return els[arguments[1]] || null;`,
    [css, index],
    { desc: `${css}[${index}] 찾기`, ...opts },
  );
  await wd.execute("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", [ref]);
  await wd.click(elementId(ref));
}

/**
 * 토스트가 전부 사라질 때까지 기다린다 — 액션이 달린 토스트는 15초를 산다.
 * 토스트는 오른쪽 아래에 고정이라, 그 자리의 버튼을 누르는 단계 앞에 부른다.
 * 닫기 버튼을 대신 누르지 않는 이유: 그 클릭 자체가 다른 요소에 가로막힐 수 있다.
 */
export function waitNoToasts(wd, opts = {}) {
  return waitFor(wd, "return document.querySelectorAll('.fixed.bottom-4 .pointer-events-auto').length === 0;", [], {
    timeout: 20_000,
    interval: 500,
    desc: "토스트가 사라짐",
    ...opts,
  });
}

/** 페이지 오류 수집기 — 이후 화면마다 새로 쌓인 것만 떼어 본다. */
export function installProbes(wd) {
  return wd.execute(`
    if (!window.__e2e) {
      window.__e2e = { errors: [] };
      window.addEventListener('error', (e) => window.__e2e.errors.push('error: ' + (e.message || e.type)));
      window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        window.__e2e.errors.push('unhandledrejection: ' + (r && (r.message || r.detail || r.code) || JSON.stringify(r)));
      });
    }
    return true;`);
}

/**
 * 네이티브 폴더 선택 창 **하나만** 대신한다 — WebDriver 는 OS 대화상자를 못 누른다.
 *
 * Tauri IPC 는 `fetch(ipc://localhost/<cmd>)`(Windows 는 `http://ipc.localhost/…`)
 * 로 나간다. `__TAURI_INTERNALS__.invoke` 는 쓰기 금지 속성이라 못 바꾸지만
 * `window.fetch` 는 바꿀 수 있다. 가로채는 것은 `select_project_folder` 의 응답뿐 —
 * 그 뒤의 `create_project`·색인·`.oculpm` 초기화는 전부 실제 경로를 탄다.
 */
export function stubFolderPicker(wd, folder) {
  return wd.execute(
    `const folder = arguments[0];
     if (!window.__e2eFetch) window.__e2eFetch = window.fetch;
     const orig = window.__e2eFetch;
     window.__e2ePicks = 0;
     window.fetch = function (input, init) {
       const url = typeof input === 'string' ? input : (input && input.url) || '';
       if (/\\/select_project_folder(\\?|$)/.test(url)) {
         window.__e2ePicks += 1;
         return Promise.resolve(new Response(JSON.stringify(folder), {
           status: 200,
           headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
         }));
       }
       return orig.apply(this, arguments);
     };
     return true;`,
    [folder],
  );
}

const LABEL_OF = `
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const labelOf = (el) => norm(el.querySelector('.topnav-label') ? el.querySelector('.topnav-label').textContent : '');`;

/**
 * 윗줄의 화면 탭 — 4.0 은 탭 넷(`.topnav`)과 끝의 설정 톱니 하나다. 사이드바는 걷었다
 * (그 옆에 목록 칸이 또 서서 왼쪽이 두 겹이었다).
 */
const ROWS = "header.topbar .topnav .topnav-item";

/** 윗줄 탭을 라벨로 찾는다 — `hit` 에 담는다. */
const NAV_ROW = `${LABEL_OF}
  const [label] = arguments;
  const hit = [...document.querySelectorAll('${ROWS}')].find((el) => labelOf(el) === label) || null;`;
const FIND_NAV = `${NAV_ROW} return hit;`;
const NAV_ACTIVE = `${NAV_ROW} return !!hit && hit.getAttribute('aria-current') === 'page';`;

/** 윗줄 탭 라벨 전부 (navRegistry 행 수와 대조). */
export async function sidebarLabels(wd) {
  return wd.execute(`${LABEL_OF}
    return [...document.querySelectorAll('${ROWS}')].map(labelOf);`);
}

/** 화면 하나로 간다 — 도착 판정은 그 행의 `aria-current="page"`. */
export async function navigateTo(wd, dest, t) {
  const label = t(dest.labelKey);
  const row = await waitFor(wd, FIND_NAV, [label], { desc: `윗줄 탭 "${label}"` });
  await wd.click(elementId(row));
  await waitFor(wd, NAV_ACTIVE, [label], { desc: `"${label}" 활성(aria-current)` });
}

/**
 * 지금 화면의 상태 — 지연 청크가 다 떴는가(스켈레톤 없음), 에러 경계가 떴는가,
 * 떠 있는 토스트, 새로 쌓인 페이지 오류.
 */
export function screenState(wd, crashTitles) {
  return wd.execute(
    `const titles = arguments[0];
     const main = document.querySelector('.content-main');
     const skeleton = !!(main && main.querySelector(':scope > .toolbar[aria-hidden="true"]'));
     const crashes = [...document.querySelectorAll('[role="alert"]')]
       .map((el) => el.innerText || '')
       .filter((txt) => titles.some((t) => txt.includes(t)))
       .map((txt) => txt.replace(/\\s+/g, ' ').slice(0, 300));
     const toasts = [...document.querySelectorAll('.z-top [role="alert"] > *, .z-top [role="status"] > *')]
       .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean);
     const errors = window.__e2e ? window.__e2e.errors.splice(0) : [];
     // 앱이 시작부터 모은 CSP 위반 (src/lib/oculpmLog.ts watchCspViolations).
     const csp = window.__oculpmCsp ? window.__oculpmCsp.splice(0) : [];
     return {
       skeleton,
       crashes,
       toasts,
       errors,
       csp,
       textLen: main ? (main.innerText || '').trim().length : -1,
       inner: [window.innerWidth, window.innerHeight],
     };`,
    [crashTitles],
  );
}

/** 지연 청크가 떠서 본문이 생길 때까지. */
export function waitScreenReady(wd, timeout = 25_000) {
  return waitFor(
    wd,
    `const main = document.querySelector('.content-main');
     if (!main) return false;
     if (main.querySelector(':scope > .toolbar[aria-hidden="true"]')) return false;
     return (main.innerText || '').trim().length > 0;`,
    [],
    { timeout, desc: "화면 본문 렌더" },
  );
}
