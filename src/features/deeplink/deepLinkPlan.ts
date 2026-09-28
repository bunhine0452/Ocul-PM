/**
 * 딥링크가 **무엇을 바꾸는가** 를 계산하는 순수 함수
 * (Osaurus 라운드 Phase 6 `#deep-link`).
 *
 * 확인 시트의 규약은 "무엇을, 어디서, 무엇이 바뀌는지" 를 보여 주는 것이다.
 * 그 세 줄을 컴포넌트가 아니라 여기서 만든다 — 링크 종류가 늘어도 문구가
 * 빠지지 않는지를 렌더 없이 단언할 수 있어야 한다.
 */

import type { DeepLink } from "@/lib/bindings";
import type { I18nKey } from "@/i18n";
import { getPlatform, type Platform } from "@/lib/platform";

export interface DeepLinkPlan {
  /** 시트 제목 키. */
  titleKey: I18nKey;
  /** "어디서" — 출처를 그대로 보여 준다 (요약하지 않는다). */
  origin: string;
  /** "무엇이 바뀌는지" — 한 줄 설명 키. */
  effectKey: I18nKey;
  /** 승인 버튼 키. */
  actionKey: I18nKey;
  /** 되돌리기 어려운 변화인가 — 시트가 강조 톤을 고른다. */
  writes: boolean;
}

export function planFor(link: DeepLink): DeepLinkPlan {
  switch (link.action) {
    case "plugin_install":
      return {
        titleKey: "deeplink.plugin.title",
        origin: `github.com/${link.source}`,
        effectKey: "deeplink.plugin.effect",
        actionKey: "deeplink.plugin.action",
        writes: true,
      };
    case "skill_install":
      return {
        titleKey: "deeplink.skill.title",
        origin: `github.com/${link.source}`,
        effectKey: "deeplink.skill.effect",
        actionKey: "deeplink.skill.action",
        writes: true,
      };
    case "theme_install":
      return {
        titleKey: "deeplink.theme.title",
        origin: link.url,
        effectKey: "deeplink.theme.effect",
        actionKey: "deeplink.theme.action",
        writes: true,
      };
    case "open":
      return {
        titleKey: "deeplink.open.title",
        origin: link.project,
        effectKey: "deeplink.open.effect",
        actionKey: "deeplink.open.action",
        // 여는 것뿐이다 — 디스크를 바꾸지 않는다.
        writes: false,
      };
  }
}

/**
 * Windows 경로를 비교 가능한 모양으로 — `\\?\` 접두를 떼고 구분자를 `/` 로, 끝의
 * 구분자를 뗀다. 대소문자는 **두고** 돌려준다(일지 상대경로는 원문 대소문자여야 한다).
 * 백엔드의 canonicalize 는 확장 길이 접두를 붙이고, VS Code 는 드라이브 글자를
 * 소문자로(`c:\…`) 준다 — 셋 다 같은 폴더다.
 */
function windowsForm(p: string): string {
  let body = p;
  if (/^\\\\\?\\UNC\\/i.test(body)) body = `\\\\${body.slice(8)}`;
  else if (body.startsWith("\\\\?\\") || body.startsWith("\\\\.\\")) body = body.slice(4);
  return body.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 두 경로가 같은 폴더인가. macOS·Linux 는 끝의 `/` 만 무시하고 대소문자를 가린다(D3). */
function sameFolder(a: string, b: string, platform: Platform): boolean {
  if (platform !== "windows") return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  return windowsForm(a).toLowerCase() === windowsForm(b).toLowerCase();
}

/**
 * `open` 은 **이미 등록된** 프로젝트만 연다. 경로가 목록에 없으면 새
 * 프로젝트를 추가하지 않고 거절한다 — 링크 하나로 임의 폴더가 추적 대상이
 * 되는 길을 막는다.
 *
 * Windows 는 구분자(`\`·`/`)·대소문자·`\\?\` 접두가 달라도 같은 폴더로 본다
 * ({#ui-winpath-followups}) — 확장이 보내는 경로와 등록 때 저장된 경로의 모양이 다르다.
 */
export function resolveRegisteredProject(
  projects: Array<{ id: number; root_path: string }>,
  wanted: string,
  platform: Platform = getPlatform(),
): number | null {
  return projects.find((p) => sameFolder(p.root_path, wanted, platform))?.id ?? null;
}

/**
 * `open` 의 목적지 — `view`/`entry` 를 `TrayNavigate` 로 옮긴다 (플랜
 * `vscode-extension-round` {#app-deeplink-entry}). `entry` 는 VS Code 확장이
 * 보내는 **일지 절대경로**인데 앱 안의 일지 주소는 `.oculpm/journal/` 기준
 * 상대경로다 — 그 프로젝트 안의 규격 경로일 때만 받는다(다른 프로젝트·`..`·
 * 임의 파일은 버리고 화면만 연다). `view` 는 알려진 화면 이름이 아니면 today.
 *
 * Windows 는 `resolveRegisteredProject` 와 같은 규칙으로 프로젝트 부분을 비교하고,
 * 돌려주는 상대경로는 `/` 구분자·원문 대소문자다.
 */
export function openNavFor(
  link: { project: string; view: string | null; entry: string | null },
  projectId: number,
  knownViews: readonly string[],
  platform: Platform = getPlatform(),
): { view: string; project_id: number; entry_path: string | null } {
  const win = platform === "windows";
  const root = win ? windowsForm(link.project) : link.project.replace(/\/+$/, "");
  const prefix = `${root}/.oculpm/journal/`;
  const entry = link.entry && win ? windowsForm(link.entry) : link.entry;
  const under = entry
    ? win
      ? entry.toLowerCase().startsWith(prefix.toLowerCase())
      : entry.startsWith(prefix)
    : false;
  let entryPath: string | null = null;
  if (entry && under) {
    const rel = entry.slice(prefix.length);
    if (/^\d{8}\/(Bugs|Features_to_add|Errors|Refactors|Chores)\/\d{4}_(bug|feature|error|refactor|chore)_[A-Za-z0-9-]+\.md$/.test(rel)) {
      entryPath = rel;
    }
  }
  const view = entryPath ? "journal" : link.view && knownViews.includes(link.view) ? link.view : "today";
  return { view, project_id: projectId, entry_path: entryPath };
}
