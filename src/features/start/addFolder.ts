/**
 * 폴더를 골라 프로젝트로 들인다 — 시작 창의 「폴더 열기」(⌘O)와 프로젝트 창 ⌘O 목록의
 * 「폴더 열기…」가 같은 길을 탄다.
 *
 * **폴더는 건드리지 않는다.** DB 에 행을 하나 만들 뿐이고, `.oculpm/`·`AGENTS.md` 는
 * 기록을 켤 때(`oculpmApi.init`) 생긴다. 이미 들인 폴더를 다시 고르면 새로 만들지
 * 않고 그 프로젝트를 돌려준다 — 같은 폴더가 목록에 둘 서면 어느 쪽이 기록을 받는지
 * 아무도 모른다.
 */
import { errorDetail, toAppError } from "@/api/invoke";
import { projectsApi } from "@/api/projects";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Project } from "@/lib/bindings";
import { pathBaseName } from "@/lib/osPath";
import { getPlatform } from "@/lib/platform";

export type AddFolderResult =
  | { kind: "cancelled" }
  /** 이미 목록에 있던 폴더. */
  | { kind: "existing"; project: Project }
  /** 새로 들였다. */
  | { kind: "added"; project: Project }
  | { kind: "error"; message: string };

/** 같은 폴더인가 — 끝 구분자는 무시하고, Windows 는 대소문자·구분자 모양도 접는다. */
export function sameFolder(a: string, b: string, windows = getPlatform() === "windows"): boolean {
  const fold = (p: string) => {
    const bare = p.replace(/[\\/]+$/, "");
    return windows ? bare.toLowerCase().replace(/\\/g, "/") : bare;
  };
  return fold(a) === fold(b);
}

function messageOf(e: unknown): string {
  // 루트·홈·시스템 폴더 거부는 코드 문자열로 온다 (commands/project.rs).
  if (errorDetail(e) === "unsafe_project_root") return t("err.code.unsafe_project_root");
  return tError(toAppError(e));
}

export async function addProjectFromFolder(): Promise<AddFolderResult> {
  let path: string | null;
  try {
    path = await projectsApi.pickFolder();
  } catch (e) {
    return { kind: "error", message: messageOf(e) };
  }
  if (!path) return { kind: "cancelled" };
  try {
    const before = await projectsApi.list();
    const known = before.find((p) => sameFolder(p.root_path, path));
    if (known) return { kind: "existing", project: known };
    const id = await projectsApi.create(pathBaseName(path) || "project", path);
    const after = await projectsApi.list();
    const project = after.find((p) => p.id === id);
    if (!project) return { kind: "error", message: t("start.addFailed") };
    return { kind: "added", project };
  } catch (e) {
    return { kind: "error", message: messageOf(e) };
  }
}
