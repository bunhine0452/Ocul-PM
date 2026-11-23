// 찍기 직후 DOM 측정 — 잘림 · 가로 넘침 · 작은 표적 · 채운 단추 수 · 대비 낮은 글자.
(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  const txt = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const all = [...document.querySelectorAll("body *")].filter(vis);
  const clipped = [];
  for (const el of all) {
    if (el.children.length > 3) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis" || cs.overflow === "hidden")) {
      clipped.push(`${label(el)} [${el.clientWidth}<${el.scrollWidth}] ${txt(el)}`);
    }
  }
  const page = { docScrollW: document.documentElement.scrollWidth, innerW: innerWidth };
  const hscroll = all
    .filter((el) => { const cs = getComputedStyle(el); return (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1; })
    .map((el) => `${label(el)} [${el.clientWidth}<${el.scrollWidth}]`);
  const targets = [...document.querySelectorAll("button, a[href], [role=button], [role=tab], input, select, [role=menuitem], [role=checkbox], [role=switch]")]
    .filter(vis)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 24 || r.height < 24)
    .map(({ el, r }) => `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)} ${txt(el)}`);
  // 채운 단추: 배경이 투명하지 않고 강조색에 가까운 단추
  const filled = [...document.querySelectorAll("button, a")].filter(vis).filter((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const [r, g, b, a = 1] = m[1].split(",").map((x) => parseFloat(x));
    if (a < 0.5) return false;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return sat > 60;
  }).map((el) => `${label(el)} ${txt(el)}`);
  // 대비: 글자 노드를 가진 요소의 색과 가장 가까운 불투명 배경
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x)); return { c: p.slice(0, 3), a: p[3] ?? 1 }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0.9) return p.c; } return [255, 255, 255]; };
  const low = [];
  for (const el of all) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const f = fg.c.map((v, i) => v * fg.a + bg[i] * (1 - fg.a)) ;
    const L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const need = size >= 18.66 || (size >= 14 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio < need && el.closest("[aria-disabled=true],:disabled") == null) low.push(`${label(el)} ${ratio.toFixed(2)} ${size}px ${txt(el).slice(0, 30)}`);
  }
  const sizes = {};
  for (const el of all) { if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { const s = getComputedStyle(el).fontSize; sizes[s] = (sizes[s] || 0) + 1; } }
  return JSON.stringify({ page, clipped: clipped.slice(0, 25), clippedCount: clipped.length, hscroll, smallTargets: targets.slice(0, 25), smallCount: targets.length, filled, lowContrast: [...new Set(low)].slice(0, 25), lowCount: low.length, fontSizes: sizes });
})()
