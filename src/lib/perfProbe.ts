/**
 * 초기 페인트 자동 측정 (`v242-load-bearing {#measure-once}` · `{#measure-after}`).
 *
 * v3-round 감사의 성능 주장은 전부 **앱을 안 켜고** 코드만 읽어 나온 구조적
 * 추정이었다. 그중 대부분은 하니스로 앱 없이 실측했지만(`docs/20260904_v242-
 * load-bearing/perf-baseline.md`), **WKWebView 의 실제 초기 페인트**만은 그
 * 웹뷰 안에서만 잴 수 있다. 사람이 화면을 만져야 하는 측정은 다음 라운드가
 * 재현하지 못하므로 — 그래서 이건 사람 손이 필요 없다.
 *
 * dev 빌드에서만 산다. 프로덕션 번들에서는 `import.meta.env.DEV` 가 상수 false 라
 * 롤업이 호출부와 이 모듈을 통째로 지운다.
 *
 * 읽는 법: 앱을 dev 로 띄우고
 *
 * ```sh
 * grep '\[perf\]' ~/Library/Application\ Support/com.kimhyunbin.ocul-pm/logs/oculpm.log.$(date +%F)
 * ```
 *
 * 로그 문자열이 영어인 것은 UI 카피가 아니라 진단 출력이기 때문이다
 * (`lint:i18n` 은 표시 문자열만 잡는다).
 */

/** 한 번만 — 창이 셋(프로젝트·트레이·분리 터미널)이라 각자 자기 것을 잰다. */
let installed = false;

interface Row {
  k: string;
  v: string | number;
}

function dump(rows: Row[]): void {
  const body = rows.map((r) => `${r.k}=${typeof r.v === "number" ? r.v.toFixed(1) : r.v}`).join(" ");
  // 콘솔 브리지(App 마운트 시 설치)가 oculpm.log 로 넘긴다.
  console.warn(`[perf] ${body}`);
}

/**
 * 스타일시트 파싱 비용을 **다시 파싱해서** 잰다.
 *
 * 최초 파싱 시각 자체는 웹뷰가 노출하지 않는다. 같은 텍스트를 새
 * `CSSStyleSheet` 에 넣는 비용이 그 대리값이고, Chromium 하니스가 쓴 방법과
 * 같아서 두 수치를 나란히 놓을 수 있다.
 */
function measureCssReparse(): { ms: number; bytes: number; sheets: number } {
  let ms = 0;
  let bytes = 0;
  let sheets = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let text: string;
    try {
      // 같은 오리진이 아니면 cssRules 접근이 던진다 — 그런 시트는 건너뛴다.
      text = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("");
    } catch {
      continue;
    }
    if (!text) continue;
    bytes += text.length;
    sheets += 1;
    const t0 = performance.now();
    try {
      new CSSStyleSheet().replaceSync(text);
    } catch {
      continue;
    }
    ms += performance.now() - t0;
  }
  return { ms, bytes, sheets };
}

/**
 * 초기 페인트 계측을 설치한다. `main.tsx` 가 dev 에서만 부른다.
 *
 * 첫 페인트가 온 뒤 한 박자 쉬고 한 줄로 쏟는다 — 페인트 직후에 재면 그
 * 측정 자체가 첫 프레임을 늘린다.
 */
export function installPerfProbe(route: string): void {
  if (installed) return;
  installed = true;

  const paints = new Map<string, number>();
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) paints.set(e.name, e.startTime);
    }).observe({ type: "paint", buffered: true });
  } catch {
    /* paint timing 미지원 웹뷰 — 나머지는 그대로 잰다 */
  }

  const report = () => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const js = res.filter((r) => r.name.endsWith(".js"));
    const css = res.filter((r) => r.name.endsWith(".css"));
    const sum = (xs: PerformanceResourceTiming[]) =>
      xs.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
    // CSS 가 **언제** 요청되기 시작하는지가 요점이다: 엔트리 JS 가 돌기 전에는
    // 링크가 없으므로, 이 값이 곧 "JS 를 기다린 시간" 이다.
    const cssStart = css.length ? Math.min(...css.map((r) => r.startTime)) : 0;
    const reparse = measureCssReparse();

    dump([
      { k: "route", v: route },
      { k: "fp", v: paints.get("first-paint") ?? -1 },
      { k: "fcp", v: paints.get("first-contentful-paint") ?? -1 },
      { k: "domInteractive", v: nav?.domInteractive ?? -1 },
      { k: "domContentLoaded", v: nav?.domContentLoadedEventEnd ?? -1 },
      { k: "loadEnd", v: nav?.loadEventEnd ?? -1 },
      { k: "jsCount", v: js.length },
      { k: "jsBytes", v: sum(js) },
      { k: "cssCount", v: css.length },
      { k: "cssBytes", v: sum(css) },
      { k: "cssFirstRequestAt", v: cssStart },
      { k: "cssReparseMs", v: reparse.ms },
      { k: "cssReparseBytes", v: reparse.bytes },
      { k: "styleSheets", v: reparse.sheets },
    ]);
  };

  // 첫 페인트가 확실히 지나간 뒤 — rAF 두 번이면 한 프레임을 넘긴다.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // 지연 청크가 붙을 시간을 조금 준다. 여기서 재는 건 "정착한 뒤의 초기 창"이다.
      setTimeout(report, 1500);
    }),
  );
}
