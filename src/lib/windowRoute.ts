/**
 * 창 라우팅 — 크롬식 탭 (docs/20260811_three-features/01b-chrome-tabs.md §2).
 *
 * 갈래는 **URL 이 정하고 런타임에 바뀌지 않는다.** 창은 자기 라벨만 URL 로
 * 받고, 어떤 탭을 물고 있는지는 백엔드 레지스트리에 물어본다 (탭 집합은
 * 런타임에 바뀌므로 URL 에 실으면 곧바로 낡는다).
 *
 * | URL                    | 라벨    | 마운트       |
 * |------------------------|---------|--------------|
 * | `index.html?tray=1`    | `tray`  | TrayApp      |
 * | `index.html?win=win-2` | `win-2` | TabbedWindow |
 * | `index.html`           | `main`  | TabbedWindow |
 *
 * "런처 전용 창" 은 더 이상 없다 — 프로젝트 메인 화면은 **시작 탭**이 되었고,
 * `tauri.conf.json` 이 만드는 첫 창(`main`)도 시작 탭 하나를 문 평범한 창이다.
 */
export type WindowRoute =
  | { kind: "tray" }
  | {
      kind: "window";
      /** 백엔드가 아는 창 라벨. 탭 커맨드의 대상 지정에 쓰인다. */
      label: string;
      /** 트레이 딥링크가 실어 보낸 목적 화면 (갓 만든 창은 emit 을 못 받는다). */
      view: string | null;
      /** 트레이 딥링크가 실어 보낸 `.oculpm` 상대 일지 경로. */
      entryPath: string | null;
    };

/** `src-tauri/src/commands/window.rs::FIRST_WINDOW`. */
export const FIRST_WINDOW = "main";

/** `src-tauri/src/commands/window.rs::is_app_window` 와 같은 규격. */
const EXTRA_WINDOW_LABEL = /^win-\d+$/;

export function parseWindowRoute(search: string): WindowRoute {
  const params = new URLSearchParams(search);
  if (params.has("tray")) return { kind: "tray" };

  const raw = params.get("win");
  // 판독 불가능한 라벨을 들고 들어가면 그 창의 모든 탭 커맨드가 조용히
  // 빗나간다 — 첫 창으로 떨어뜨리는 편이 훨씬 낫다.
  const label =
    raw !== null && (raw === FIRST_WINDOW || EXTRA_WINDOW_LABEL.test(raw)) ? raw : FIRST_WINDOW;

  return {
    kind: "window",
    label,
    view: params.get("view"),
    entryPath: params.get("entry"),
  };
}
