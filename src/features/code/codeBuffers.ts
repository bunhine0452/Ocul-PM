// 편집 버퍼 캐시 — 모듈 스코프 (recentChangesStore 와 같은 이유: 화면/파일을
// 오가며 컴포넌트가 언마운트돼도 **미저장 편집이 살아남아야** 한다. 확인
// 다이얼로그로 전환을 막는 것보다 낫다).
//
// 영속하지 않는다 — 미저장 편집은 "이 세션의 진행 중 작업"이고, 재시작 후
// 디스크와 다른 유령 버퍼가 살아나는 쪽이 더 위험하다.

export interface CodeBuffer {
  /** 에디터의 현재 텍스트. */
  text: string;
  /** 마지막 로드/저장 시점의 디스크 텍스트 — dirty 판정 기준. */
  baseText: string;
  /** 그 시점의 blake3 해시 — 저장 시 낙관적 잠금 토큰. */
  baseHash: string;
}

/**
 * 캐시 상한. 초과 시 **깨끗한 버퍼부터** 오래된 순으로 내보내고, 전부 dirty 면
 * 가장 오래된 dirty 를 내보낸다 (무한 성장 방지가 편집 보존보다 우선하는
 * 마지막 안전판 — 20개 파일을 동시에 미저장으로 두는 상황 자체가 신호다).
 */
export const CODE_BUFFER_CAP = 20;

const buffers = new Map<string, CodeBuffer>();

export function bufferKey(projectId: number, relPath: string): string {
  return `${projectId}:${relPath}`;
}

export function isDirty(buf: CodeBuffer): boolean {
  return buf.text !== buf.baseText;
}

export function getBuffer(key: string): CodeBuffer | undefined {
  return buffers.get(key);
}

export function putBuffer(key: string, buf: CodeBuffer): void {
  // 재삽입으로 Map 순서를 갱신 — Map 은 삽입순 순회라 이게 곧 LRU 다.
  buffers.delete(key);
  buffers.set(key, buf);
  if (buffers.size <= CODE_BUFFER_CAP) return;
  const oldestClean = [...buffers.entries()].find(([, b]) => !isDirty(b))?.[0];
  const evict = oldestClean ?? buffers.keys().next().value;
  if (evict !== undefined) buffers.delete(evict);
}

export function deleteBuffer(key: string): void {
  buffers.delete(key);
}

/** 이 프로젝트에서 dirty 인 파일 경로들 — 트리의 미저장 배지용. */
export function listDirtyPaths(projectId: number): Set<string> {
  const prefix = `${projectId}:`;
  const out = new Set<string>();
  for (const [key, buf] of buffers) {
    if (key.startsWith(prefix) && isDirty(buf)) out.add(key.slice(prefix.length));
  }
  return out;
}

/** 테스트 전용 — 상태 초기화. */
export function _resetBuffers(): void {
  buffers.clear();
}
