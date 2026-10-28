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
}

/** 링크는 여는 것 하나뿐이다 — 디스크를 바꾸지 않는다 (설치 링크는 4.0 에서 걷었다). */
export function planFor(link: DeepLink): DeepLinkPlan {
  return {
    titleKey: "deeplink.open.title",
    origin: link.project,
    effectKey: "deeplink.open.effect",
    actionKey: "deeplink.open.action",
  };
}

/**
 * Windows 경로를 비교 가능한 모양으로 — `\\?\` 접두를 떼고 구분자를 `/` 로, 끝의
 * 구분자를 뗀다(대소문자는 비교하는 쪽이 접는다).
 * 백엔드의 canonicalize 는 확장 길이 접두를 붙이고, 링크를 만드는 쪽은 드라이브
 * 글자를 소문자로(`c:\…`) 줄 수 있다 — 셋 다 같은 폴더다.
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
 * ({#ui-winpath-followups}) — 링크가 실어 오는 경로와 등록 때 저장된 경로의 모양이 다를 수 있다.
 */
export function resolveRegisteredProject(
  projects: Array<{ id: number; root_path: string }>,
  wanted: string,
  platform: Platform = getPlatform(),
): number | null {
  return projects.find((p) => sameFolder(p.root_path, wanted, platform))?.id ?? null;
}

/**
 * `open` 의 목적지 — `view` 를 `WindowNavigate` 로 옮긴다. 알려진 화면 이름이
 * 아니면 today.
 */
export function openNavFor(
  link: { view: string | null },
  projectId: number,
  knownViews: readonly string[],
): { view: string; project_id: number; entry_path: null } {
  const view = link.view && knownViews.includes(link.view) ? link.view : "today";
  return { view, project_id: projectId, entry_path: null };
}
