/**
 * 터미널 칸의 크기 재기 (2026-11-15) — 새 세션을 칸에 맞는 크기로 열고, 맞춘 격자를 칸 가운데에 둔다.
 * `termStore.ts` 가 800줄을 넘지 않게 떼어 냈다.
 *
 * - 새 세션은 80×24 로 열렸다 — 「다음」 의 claude 가 첫 화면을 80칸에 찍었다가 칸에 맞춰 다시 그렸다.
 *   이제 설 자리를 마지막으로 잰 셀 크기(처음이면 xterm 과 같은 길로 숨겨 잰다)로 나눠 연다.
 * - 칸 수로 나누고 남은 자투리(한 칸이 안 되는 폭)는 늘 오른쪽에만 남아 격자가 왼쪽으로 쏠렸다(Claude
 *   상자의 좌우 여백이 달랐다). 이제 그 반을 왼쪽에 둔다.
 */
import type { Terminal } from "@xterm/xterm";

interface Size {
  width: number;
  height: number;
}

/** 마지막으로 잰 셀 크기(CSS px) · 세션이 설 자리 — 새 세션을 그 크기로 연다. */
let lastCell: Size | null = null;
let lastBox: Size | null = null;
/** 세로 스크롤바의 폭 — 한 번 재면 둔다(앱의 얇은 스크롤바는 CSS 로 10px 고정). */
let scrollbarPx: number | null = null;

/** 세션이 그리는 셀 크기 — xterm 이 공개하지 않아 렌더러의 값을 읽는다(addon-fit 도 같은 값을 쓴다). */
function cellOf(term: Terminal): Size | null {
  type Core = { _core?: { _renderService?: { dimensions?: { css?: { cell?: Size } } } } };
  const cell = (term as unknown as Core)._core?._renderService?.dimensions?.css?.cell;
  return cell && cell.width > 0 && cell.height > 0 ? { width: cell.width, height: cell.height } : null;
}

/**
 * 처음 여는 세션의 셀 크기 — xterm 이 재는 길(글자 「W」 의 폭 · 글꼴 높이)을 그대로 따라 장치 픽셀로
 * 반올림한다. 잴 수 없으면(OffscreenCanvas 가 없는 곳) `null`.
 */
function measureCell(font: string, fontSize: number, lineHeight: number): Size | null {
  let charW = 0;
  let charH = 0;
  try {
    const ctx = new OffscreenCanvas(100, 100).getContext("2d");
    if (ctx) {
      ctx.font = `${fontSize}px ${font}`;
      const m = ctx.measureText("W");
      charW = m.width;
      charH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    }
  } catch {
    /* 잴 수 없다 — 아래에서 null */
  }
  if (!(charW > 0 && charH > 0)) return null;
  const dpr = window.devicePixelRatio || 1;
  return {
    width: Math.floor(charW * dpr) / dpr,
    height: Math.floor(Math.ceil(charH * dpr) * lineHeight) / dpr,
  };
}

/** 세로 스크롤바의 폭 — xterm 이 그 폭만큼 오른쪽을 비운다. 레이아웃이 없는 곳(jsdom)은 0. */
function scrollbarWidth(parent: HTMLElement): number {
  if (scrollbarPx !== null) return scrollbarPx;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;overflow-y:scroll;width:100px;height:100px";
  parent.appendChild(probe);
  const width = Math.max(0, probe.offsetWidth - probe.clientWidth);
  if (probe.offsetWidth > 0) scrollbarPx = width;
  probe.remove();
  return width;
}

/**
 * 새 세션이 설 자리(CSS px) — 고른 칸, 없으면 첫 칸, 칸이 하나도 없으면 터미널 본문에 빈 칸을 잠깐 세워
 * 그 안의 호스트를 잰다(칸의 여백을 여기서 다시 적지 않게). 터미널 화면이 안 떠 있으면(오늘의 「다음」)
 * 마지막으로 잰 자리.
 */
function measureBox(): Size | null {
  if (typeof document === "undefined") return lastBox;
  let pane =
    document.querySelector<HTMLElement>(".tm-leaf.is-active .tm-pane") ?? document.querySelector<HTMLElement>(".tm-pane");
  let temp: HTMLElement | null = null;
  const body = pane ? null : document.querySelector<HTMLElement>(".tm-panes");
  if (body) {
    temp = document.createElement("div");
    temp.className = "tm-pane";
    body.appendChild(temp);
    pane = temp;
  }
  if (!pane) return lastBox;
  const probe = document.createElement("div");
  probe.className = "term-host";
  probe.style.visibility = "hidden";
  pane.appendChild(probe);
  const box = { width: probe.clientWidth - scrollbarWidth(probe), height: probe.clientHeight };
  probe.remove();
  temp?.remove();
  return box.width > 0 && box.height > 0 ? box : lastBox;
}

/** 새 세션의 첫 크기 — 설 자리를 셀 크기로 나눈다. 못 재면 `null`(xterm 기본 80×24). */
export function initialSize(font: string, fontSize: number, lineHeight: number): { cols: number; rows: number } | null {
  const box = measureBox();
  const cell = box ? (lastCell ?? measureCell(font, fontSize, lineHeight)) : null;
  if (!box || !cell) return null;
  return {
    cols: Math.max(2, Math.floor(box.width / cell.width)),
    rows: Math.max(1, Math.floor(box.height / cell.height)),
  };
}

/**
 * 칸에 맞춘 뒤 — 셀 크기와 설 자리를 기억하고, 자투리의 반을 왼쪽에 둬 격자를 가운데에. 화면 요소의 바깥
 * 여백이라 맞추기(FitAddon) 계산에는 들지 않는다(xterm 은 그 요소의 폭 · 높이만 적는다).
 */
export function afterFit(term: Terminal, host: HTMLElement, width: number, height: number): void {
  const cell = cellOf(term);
  lastCell = cell ?? lastCell;
  const usable = width - scrollbarWidth(host);
  lastBox = { width: usable, height };
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (screen && cell) screen.style.marginLeft = `${Math.max(0, Math.floor((usable - term.cols * cell.width) / 2))}px`;
}

/** 화면 배율이 바뀌었다 — 셀 크기는 장치 픽셀로 반올림되니 다음 맞추기에서 다시 잰다. */
export function forgetCell(): void {
  lastCell = null;
}
