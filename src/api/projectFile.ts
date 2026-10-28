/**
 * `projectFileApi` — 프로젝트 안 파일 하나를 읽는다 (경로 가드는 백엔드 `secure_join`).
 *
 * 변경 화면이 스냅숏 없는 새 파일의 본문을 보여 줄 때 쓴다. 코드 편집기가 걷히면서(2026-10-28)
 * `codeApi` 는 사라졋고, 이 읽기 하나만 남았다.
 */
import { commands } from "@/lib/bindings";
import { call } from "./invoke";

export const projectFileApi = {
  read: (projectId: number, relPath: string): Promise<string> =>
    call("read_project_file", commands.readProjectFile(projectId, relPath)),
};
