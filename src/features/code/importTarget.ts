// Finder 에서 온 파일이 **어느 폴더로** 들어갈지 정하는 규칙.
//
// DOM 을 모르는 순수 함수로 뽑아 둔다 — 좌표→행 찾기(웹뷰 일)와 "그래서 어디에
// 놓는가"(제품 규칙)는 다른 문제이고, 틀리면 곤란한 쪽은 뒤쪽이다.
import { parentDir } from "./fileOps";

/** 트리 행 한 줄에서 읽어 낸 것. */
export interface TreeHit {
  /** 프로젝트 루트 기준 경로. */
  path: string;
  isDir: boolean;
}

/**
 * 목적지 폴더 (`""` = 프로젝트 루트).
 *
 * `hit` 은 커서 **아래**의 행(드래그), `selected` 는 지금 고른 항목(⌘V — 커서가
 * 없다). 파일 위에 놓는 것은 "그 옆에 놓아 달라"는 뜻이라 부모 폴더로 접는다 —
 * VS Code 도 같다.
 */
export function importDestDir(hit: TreeHit | null, selected: TreeHit | null): string {
  const target = hit ?? selected;
  if (!target) return "";
  return target.isDir ? target.path : parentDir(target.path);
}

/** 목적지를 사람이 읽는 이름으로 — 루트는 경로가 빈 문자열이라 이름이 필요하다. */
export function destLabel(dir: string, rootName: string): string {
  return dir === "" ? rootName : dir;
}
