// 프로젝트 커맨드 래퍼 (2026-10-01 `{#api-facades}`, 4.0 에서 시작 창·설정이 옮겨 왔다).
//
// 목록·폴더 고르기·등록·목록에서 빼기·최근 활동 집계, 그리고 이 프로젝트의 규칙
// 파일(AGENTS.md 템플릿) 판 상태. 시작 창과 설정 「이 프로젝트」가 쓴다.
import { commands, events, type HomeBrief, type Project } from "@/lib/bindings";
import { call, subscribe } from "./invoke";

/** 규칙 파일 판 차이 — `from` 이 디스크, `to` 가 앱이 든 판(또는 그 반대, 아래 참고). */
export interface TemplateGap {
  from_version: number;
  to_version: number;
}

export const projectsApi = {
  list: (): Promise<Project[]> => call("list_projects", commands.listProjects()),

  /** OS 폴더 고르기 — 취소하면 `null`. */
  pickFolder: (): Promise<string | null> => call("select_project_folder", commands.selectProjectFolder()),

  /**
   * 폴더를 프로젝트로 등록한다 — DB 행만 만들고 **폴더는 건드리지 않는다**(기록 켜기는
   * `oculpmApi.init`). 루트·홈·시스템 폴더는 `unsafe_project_root` 로 거절된다.
   */
  create: (name: string, rootPath: string): Promise<number> =>
    call("create_project", commands.createProject(name, rootPath)),

  /** 목록에서 뺀다 — 폴더의 `.oculpm`·`AGENTS.md` 는 그대로 둔다. */
  forget: (projectId: number): Promise<null> => call("delete_project", commands.deleteProject(projectId, false, false)),

  /** 프로젝트마다 오늘·최근 활동 — `days` 는 날짜별 수를 담을 창(오늘 포함). */
  brief: (days: number): Promise<HomeBrief> => call("home_brief", commands.homeBrief(days)),

  /** 디스크의 규칙 파일이 앱이 든 판보다 **낮으면** 그 차이, 같거나 높으면 `null`. */
  templateUpgrade: (projectId: number): Promise<TemplateGap | null> =>
    call("oculpm_agents_check_master_upgrade", commands.oculpmAgentsCheckMasterUpgrade(projectId)),

  /** 디스크의 규칙 파일이 앱보다 **새롭다** — 고칠 길은 앱 업데이트뿐이다. */
  templateAhead: (projectId: number): Promise<TemplateGap | null> =>
    call("oculpm_agents_check_master_ahead", commands.oculpmAgentsCheckMasterAhead(projectId)),

  /** 규칙 파일을 앱이 든 판으로 올리고 어댑터(AGENTS.md 등)를 다시 맞춘다. */
  applyTemplateUpgrade: (projectId: number): Promise<unknown> =>
    call("oculpm_agents_apply_master_upgrade", commands.oculpmAgentsApplyMasterUpgrade(projectId)),

  /** 일지가 새로 섰다 — 시작 창이 「첫 일지가 오면 그 프로젝트로 넘어간다」를 듣는다. */
  onJournalAdded: (cb: (projectId: number) => void): Promise<() => void> =>
    subscribe(events.oculpmJournalAdded, (p) => cb(p.project_id)),
};
