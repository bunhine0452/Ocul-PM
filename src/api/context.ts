/**
 * `contextApi` — 컨텍스트 경제학 커맨드 래퍼 (Osaurus 라운드 Phase 5).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`).
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type {
  PlanSummary,
  RecallStat,
  RulesOverview,
  SkillsOverview,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

/**
 * 매니페스트·본문 로드가 읽는 것들.
 *
 * 새 파일은 `bindings` 를 직접 부르지 않는다(`lint:bindings`). 컨텍스트 조립은
 * 여러 도메인(규칙·스킬·계획·일지)을 가로질러 읽으므로, 그 읽기를 도메인
 * 래퍼마다 흩지 않고 **이 Phase 의 래퍼 한 곳**에 모은다.
 *
 * 전부 **실패해도 던지지 않는다** — 매니페스트는 best-effort 다. 한 소스가
 * 죽었다고 대화가 못 시작되면 안 된다.
 */
export const contextRead = {
  rules: async (projectId: number): Promise<RulesOverview | null> => {
    const res = await commands.rulesList(projectId);
    return res.status === "ok" ? res.data : null;
  },
  skills: async (projectId: number): Promise<SkillsOverview | null> => {
    const res = await commands.skillsList(projectId);
    return res.status === "ok" ? res.data : null;
  },
  plans: async (projectId: number): Promise<PlanSummary[]> => {
    const res = await commands.planList(projectId);
    return res.status === "ok" ? res.data : [];
  },
  journalList: async (projectId: number) => {
    const res = await commands.oculpmListJournalEntries(projectId, null, null);
    return res.status === "ok" ? res.data : [];
  },
  rulesMaster: async (projectId: number): Promise<string> => {
    const res = await commands.oculpmAgentsGetMasterTemplate(projectId);
    return res.status === "ok" ? res.data : "";
  },
  ruleBody: async (projectId: number, scope: "project" | "global", relPath: string) => {
    const res = await commands.rulesRead(projectId, scope, relPath);
    return res.status === "ok" ? res.data.content : null;
  },
  skillBody: async (projectId: number, scope: "project" | "global", dirName: string) => {
    const res = await commands.skillsRead(projectId, scope, dirName);
    return res.status === "ok" ? res.data.content : null;
  },
  plan: async (projectId: number, planId: string) => {
    const res = await commands.planGet(projectId, planId);
    return res.status === "ok" ? res.data : null;
  },
  journalEntry: async (projectId: number, relativePath: string) => {
    const res = await commands.oculpmGetJournalEntry(projectId, relativePath);
    return res.status === "ok" ? res.data : null;
  },
};

export const contextApi = {
  /** 관련도 상위 N (감쇠 반영). */
  top: (projectId: number, limit = 20) =>
    unwrap<RecallStat[]>("recall_top", commands.recallTop(projectId, limit)),

  /** 주입됐다고 기록 — 실패해도 대화를 막지 않는다 (파생 캐시다). */
  touch: (projectId: number, kind: string, reference: string) =>
    unwrap<null>("recall_touch", commands.recallTouch(projectId, kind, reference)),

  forget: (projectId: number, kind: string, reference: string) =>
    unwrap<boolean>("recall_forget", commands.recallForget(projectId, kind, reference)),

  reset: (projectId: number) => unwrap<number>("recall_reset", commands.recallReset(projectId)),

  instructionsGet: (projectId: number) =>
    unwrap<string>("project_instructions_get", commands.projectInstructionsGet(projectId)),

  instructionsSet: (projectId: number, text: string) =>
    unwrap<null>("project_instructions_set", commands.projectInstructionsSet(projectId, text)),
};
