// 터미널 도우미 — xterm 버퍼 읽기 · 입력칸 초점 · 키 · 붙여넣기 · 입력 이벤트 기록.

import { elementId } from "./webdriver.mjs";
import { clickCss, sleep, waitFor } from "./page.mjs";

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

/**
 * 입력칸에 도착하는 DOM 이벤트를 기록한다 — 실패했을 때 "웹뷰가 무엇을 만들었나"
 * 를 증거로 남기려고 (키 합성이 한글을 못 싣는지, 조합 이벤트 순서가 어땠는지).
 */
export function recordInput(wd) {
  return wd.execute(`
    const ta = document.activeElement;
    if (!ta || !ta.classList.contains('xterm-helper-textarea')) return false;
    window.__e2eInput = [];
    if (!ta.__e2eRec) {
      ta.__e2eRec = true;
      for (const type of ['keydown', 'keypress', 'compositionstart', 'compositionupdate', 'compositionend', 'input', 'paste']) {
        ta.addEventListener(type, (e) => {
          if (!window.__e2eInput || window.__e2eInput.length > 200) return;
          const bits = [type];
          if (e.key !== undefined) bits.push(JSON.stringify(e.key) + '/' + e.keyCode);
          if (e.inputType) bits.push(e.inputType);
          if (e.data !== undefined && e.data !== null) bits.push(JSON.stringify(e.data));
          if (e.isComposing) bits.push('composing');
          window.__e2eInput.push(bits.join(' '));
        }, true);
      }
    }
    return true;`);
}

export async function takeInput(wd) {
  const events = (await wd.execute("const e = window.__e2eInput || []; window.__e2eInput = []; return e;")) ?? [];
  return events.join(" · ");
}

/**
 * 붙여넣기 — 사용자가 한글을 터미널에 넣는 실제 경로 중 하나. WebDriver 키
 * 합성은 입력기를 거치지 않아 한글을 싣지 못한다(WebKitGTK 실측: `echo 한글-ok`
 * 가 `echo -ok` 로 도착). xterm 은 입력칸의 `paste` 이벤트를 받아 PTY 로 보낸다.
 */
export function pasteText(wd, text) {
  return wd.execute(
    `const ta = document.activeElement;
     if (!ta || !ta.classList.contains('xterm-helper-textarea')) return 'no-focus';
     const dt = new DataTransfer();
     dt.setData('text/plain', arguments[0]);
     const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
     ta.dispatchEvent(ev);
     return ev.defaultPrevented ? 'paste handled' : 'paste dispatched';`,
    [text],
  );
}

/** 셸이 무엇이든 한 줄(프롬프트)을 그릴 때까지. */
export async function waitBuffer(wd, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const r = await readTerminal(wd);
    if (r.lines.some((l) => l.trim())) return r;
    if (Date.now() > deadline) {
      throw new Error(`셸 프롬프트가 ${timeout / 1000}초 안에 안 떴다 (xterm ${r.count}개, 인스턴스 찾음=${r.found})`);
    }
    await sleep(400);
  }
}

/** 버퍼에서 어떤 줄이 `want` 와 **정확히** 같아질 때까지 (앞뒤 공백 무시). */
export async function waitLine(wd, want, timeout) {
  const deadline = Date.now() + timeout;
  let last = { lines: [] };
  while (Date.now() < deadline) {
    last = await readTerminal(wd);
    if (last.lines.some((l) => l.trim() === want)) return last;
    await sleep(300);
  }
  const tail = last.lines.slice(-12).map((l) => JSON.stringify(l)).join(" / ");
  throw new Error(`터미널에 "${want}" 줄이 ${timeout / 1000}초 안에 안 나왔다 — 마지막 줄들: ${tail}`);
}
