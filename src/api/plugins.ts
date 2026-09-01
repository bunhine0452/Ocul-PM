/**
 * `pluginsApi` — Claude 플러그인 번들 임포트 래퍼 (Osaurus 라운드 Phase 6).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`).
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type {
  BundleImportResult,
  BundleRemoveReport,
  BundleSourceKind,
  InstalledBundle,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const pluginsApi = {
  /** `.zip` 번들 고르기. 취소하면 `null`. */
  pickBundle: () => unwrap<string | null>("plugin_pick_bundle", commands.pluginPickBundle()),

  /**
   * 미리보기(`dry`)와 설치가 같은 문이다 — 미리 본 것과 일어난 것이
   * 갈라질 길을 없앤다.
   */
  import: (
    projectId: number,
    kind: BundleSourceKind,
    src: string,
    dry: boolean,
    replace: boolean,
  ) =>
    unwrap<BundleImportResult>(
      "plugin_import",
      commands.pluginImport(projectId, kind, src, dry, replace),
    ),

  list: (projectId: number) =>
    unwrap<InstalledBundle[]>("plugin_list", commands.pluginList(projectId)),

  remove: (projectId: number, bundleId: string) =>
    unwrap<BundleRemoveReport>("plugin_remove", commands.pluginRemove(projectId, bundleId)),
};
