/**
 * `themesApi` — 테마 커맨드의 단일 래퍼 (Osaurus 라운드 Phase 4).
 *
 * 봉투(`{status}`)를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`). 새 파일은 `bindings.ts` 를 직접 부르지
 * 않는다 — `lint:bindings` 가 그 규율을 지킨다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands, events } from "@/lib/bindings";
import type { ThemeFile, ThemeImportOutcome, ThemesChanged } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const themesApi = {
  /** 사용자가 만든 테마만. 내장 5종은 프런트가 정적으로 들고 있다. */
  list: () => unwrap<ThemeFile[]>("theme_list", commands.themeList()),

  save: (theme: ThemeFile) => unwrap<ThemeFile>("theme_save", commands.themeSave(theme)),

  remove: (id: string) => unwrap<boolean>("theme_delete", commands.themeDelete(id)),

  /**
   * 가져오기. `path` 가 없으면 파일 선택 대화상자를 연다. 같은 이름이 있으면
   * `status: "conflict"` 로 돌아오고, 사용자에게 물은 뒤 같은 `source_path` 와
   * `mode`("overwrite" | "copy")로 다시 부른다 — 파일을 두 번 고르게 하지 않는다.
   */
  import: (path: string | null = null, mode: "overwrite" | "copy" | null = null) =>
    unwrap<ThemeImportOutcome>("theme_import", commands.themeImport(path, mode)),

  /**
   * 링크로 받은 테마 가져오기 (oculpm.com/themes 의 「앱에서 가져오기」).
   * 딥링크 확인 시트를 지난 뒤에만 부른다 — https + 호스트 화이트리스트는
   * 백엔드가 다시 검사한다. 충돌 뒤 재시도는 파일 임포트와 같은 길이라
   * `source_path` 로 `import(path, mode)` 를 부르면 된다 (다시 받지 않는다).
   */
  importUrl: (url: string, mode: "overwrite" | "copy" | null = null) =>
    unwrap<ThemeImportOutcome>("theme_import_url", commands.themeImportUrl(url, mode)),

  /** 저장 대화상자 → 경로. 취소하면 `null`. */
  export: (theme: ThemeFile) =>
    unwrap<string | null>("theme_export", commands.themeExport(theme)),

  /** macOS 시스템 강조색 (hex). 다른 OS 이거나 읽지 못하면 `null`. */
  systemAccent: () => unwrap<string | null>("system_accent", commands.systemAccent()),

  /** 프로젝트에 테마를 묶는다. `null` = 해제(전역 설정으로 폴백). */
  setProjectTheme: (projectId: number, themeId: string | null) =>
    unwrap<null>("set_project_theme", commands.setProjectTheme(projectId, themeId)),

  /**
   * 테마 목록·바인딩 변경 구독. 창이 여럿이라 한쪽에서 저장한 테마가 나머지
   * 창에도 즉시 닿아야 한다 (설정의 `settingsChanged` 와 같은 이유).
   *
   * 이벤트 채널이 없는 환경(테스트 · 웹뷰 밖)에서도 살아야 하므로 실패는
   * 삼키고 no-op 해제 함수를 돌려준다.
   */
  onChanged: (cb: (e: ThemesChanged) => void): (() => void) => {
    let off: (() => void) | null = null;
    let cancelled = false;
    try {
      void events.themesChanged
        .listen((e) => cb(e.payload))
        .then((fn) => {
          if (cancelled) fn();
          else off = fn;
        })
        .catch(() => {});
    } catch {
      /* 이벤트 채널 없음 */
    }
    return () => {
      cancelled = true;
      off?.();
    };
  },
};
