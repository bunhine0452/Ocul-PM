// 프로젝트 목록 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 지금은 읽기 하나 — 분리 터미널 창이 자기 프로젝트의 이름·루트·테마를 찾는다.
// 시작 탭·탭 스트립의 만들기·지우기·이름 바꾸기는 아직 `commands` 를 직접 쓴다
// (`lint:bindings` allowlist) — 그 파일들을 손볼 때 여기로 옮긴다.
import { commands, type Project } from "@/lib/bindings";
import { call } from "./invoke";

export const projectsApi = {
  list: (): Promise<Project[]> => call("list_projects", commands.listProjects()),
};
