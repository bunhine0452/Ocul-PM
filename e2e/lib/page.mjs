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

/** CSS 로 찾은 n 번째 **보이는** 요소를 실제 클릭. */
export async function clickCss(wd, css, index = 0, opts = {}) {
  const ref = await waitFor(
    wd,
    `const els = [...document.querySelectorAll(arguments[0])].filter(e => e.getClientRects().length > 0 && !e.disabled);
     return els[arguments[1]] || null;`,
    [css, index],
    { desc: `${css}[${index}] 찾기`, ...opts },
  );
  await wd.click(elementId(ref));
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
  const labelOf = (el) => norm([...el.children]
    .filter((c) => c.tagName === 'SPAN' && !c.className)
    .map((c) => c.textContent).join(' '));`;

/** 사이드바 행(또는 에이전트 갈래)을 라벨로 찾는다 — `hit` 에 담는다. */
const NAV_ROW = `${LABEL_OF}
  const [label, branch] = arguments;
  const sel = branch ? 'nav.sidebar .nav-branches .subnav-item' : 'nav.sidebar .side-nav-scroll .nav-item';
  const hit = [...document.querySelectorAll(sel)].find((el) => labelOf(el) === label) || null;`;
const FIND_NAV = `${NAV_ROW} return hit;`;
const NAV_ACTIVE = `${NAV_ROW} return !!hit && hit.getAttribute('aria-current') === 'page';`;

/** 사이드바 행 라벨 전부 (navRegistry 행 수와 대조). */
export function sidebarLabels(wd) {
  return wd.execute(`${LABEL_OF}
    return [...document.querySelectorAll('nav.sidebar .side-nav-scroll .nav-item')].map(labelOf);`);
}

/**
 * 화면 하나로 간다 — 갈래 화면(Codex·세션 …)이면 부모 행(에이전트)을 먼저 연다.
 * 도착 판정은 그 행의 `aria-current="page"`.
 */
export async function navigateTo(wd, dest, t) {
  const label = t(dest.labelKey);
  if (dest.parentLabelKey) {
    const open = await wd.execute(FIND_NAV, [label, true]);
    if (!open) {
      const parent = await waitFor(wd, FIND_NAV, [t(dest.parentLabelKey), false], { desc: `사이드바 "${t(dest.parentLabelKey)}"` });
      await wd.click(elementId(parent));
    }
  }
  const row = await waitFor(wd, FIND_NAV, [label, Boolean(dest.parentLabelKey)], { desc: `사이드바 "${label}"` });
  await wd.click(elementId(row));
  await waitFor(wd, NAV_ACTIVE, [label, Boolean(dest.parentLabelKey)], {
    desc: `"${label}" 활성(aria-current)`,
  });
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
     return {
       skeleton,
       crashes,
       toasts,
       errors,
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

/**
 * 화면의 xterm 버퍼를 읽는다. xterm 은 WebGL 캔버스에 그려서 DOM 에 글자가 없다
 * (DOM 렌더러일 때만 있다). 그래서 React 파이버를 거슬러 올라가
 * `TerminalInstanceImpl` 의 `termRef` — `buffer.active` 와 `onData` 를 가진
 * 객체 — 를 찾는다. 이름이 아니라 **모양**으로 찾으므로 리팩터에 덜 깨진다.
 */
export function readTerminal(wd) {
  return wd.execute(`
    const root = document.querySelector('.content-main');
    const xterms = [...(root ? root.querySelectorAll('.xterm') : [])].filter((e) => e.getClientRects().length > 0);
    const findTerm = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
        if (!key) continue;
        for (let f = node[key]; f; f = f.return) {
          let h = f.memoizedState, guard = 0;
          while (h && typeof h === 'object' && guard++ < 400) {
            const v = h.memoizedState;
            const cur = v && typeof v === 'object' && 'current' in v ? v.current : null;
            if (cur && cur.buffer && cur.buffer.active && typeof cur.buffer.active.getLine === 'function'
                && typeof cur.onData === 'function') return cur;
            h = h.next;
          }
        }
        return null;
      }
      return null;
    };
    for (const el of xterms) {
      const term = findTerm(el);
      if (!term) continue;
      const b = term.buffer.active;
      const lines = [];
      for (let i = Math.max(0, b.length - 300); i < b.length; i++) {
        const line = b.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return { found: true, count: xterms.length, lines };
    }
    return { found: false, count: xterms.length, lines: [] };`);
}

/**
 * 터미널에 초점을 주고 입력칸(xterm 숨은 textarea)의 요소 id 를 돌려준다. 클릭이
 * 막혀도(겹친 층) 초점은 JS 로 준다 — 이 단계가 보려는 것은 입력 경로다.
 */
export async function focusTerminal(wd) {
  try {
    await clickCss(wd, ".content-main .xterm-screen", 0, { timeout: 5_000 });
  } catch {
    /* 아래에서 JS 로 초점 */
  }
  const ref = await waitFor(
    wd,
    `const ta = [...document.querySelectorAll('.content-main .xterm-helper-textarea')]
       .find((e) => e.closest('.xterm') && e.closest('.xterm').getClientRects().length > 0);
     if (!ta) return null;
     ta.focus();
     return document.activeElement === ta ? ta : null;`,
    [],
    { desc: "xterm 입력칸 초점" },
  );
  return elementId(ref);
}

/**
 * 글자 입력. 먼저 W3C "Element Send Keys" — 안 되면(숨은 textarea 를 상호작용
 * 불가로 보는 드라이버) 초점을 둔 채 Actions 로 한 글자씩.
 */
export async function typeText(wd, el, text) {
  try {
    await wd.sendKeys(el, text);
    return "element-send-keys";
  } catch (e) {
    const actions = [...text].flatMap((ch) => [
      { type: "keyDown", value: ch },
      { type: "keyUp", value: ch },
    ]);
    await wd.req("POST", wd.s("/actions"), { actions: [{ type: "key", id: "kbd", actions }] });
    await wd.req("DELETE", wd.s("/actions"));
    return `actions (send-keys 실패: ${e.code ?? e.message})`;
  }
}
