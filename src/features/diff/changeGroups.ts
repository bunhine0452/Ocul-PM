// 변경 화면의 순수 모델 (4.0) — 변경 파일을 「일지에 있음」 / 「기록 없음」 둘로 가른다.
// 렌더와 분리해 두는 이유: j/k 이동 순서가 목록에 보이는 순서와 같은 소스여야 하는데, 그 계약을
// 컴포넌트 안에 두면 테스트할 수가 없다.

import type { ChangeGroup } from "@/lib/bindings";
import type { RecentChange } from "@/lib/recentChangesStore";

/**
 * 일지·플랜 제목에서 마크다운 마커를 걷어낸다. 제목은 파일에 적힌 그대로라
 * `# ◎ ACP 에이전트 패널` / `한 프로젝트에서 **대화 여러 개**` 처럼 문법 기호를
 * 달고 온다 — 한 줄로 줄여 놓으면 닫는 `**` 가 잘려 나가 더 지저분해진다.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\[[ xX]\]\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

export interface ChangeBuckets {
  /**
   * 묶음 정보가 있는가. `false` 면(아직 오는 중이거나 조회가 실패했다) 어느 파일도 「기록 없음」 이라고
   * 말하지 않는다 — 모르는 것을 단언하면 이 화면의 약속(믿지 말고 보라)이 거짓이 된다.
   */
  known: boolean;
  /** 어느 일지에도 없는 파일 — 최근 변경이 위. */
  unrecorded: string[];
  /** 일지에 있는 묶음 (최신 일지가 위, 백엔드 순서) — 현재 변경 목록에 남은 파일만. */
  groups: ChangeGroup[];
}

/** `changes` 는 오래된 것이 앞이다 (`mergeChanges`) — 보여 줄 때는 뒤집어 최근이 위. */
export function splitChanges(groups: ChangeGroup[] | null, changes: readonly RecentChange[]): ChangeBuckets {
  if (!groups) return { known: false, unrecorded: [], groups: [] };
  const present = new Set(changes.map((c) => c.path));
  const rank = new Map(changes.map((c, i) => [c.path, i] as const));
  const recorded: ChangeGroup[] = [];
  let unrecorded: string[] = [];
  for (const g of groups) {
    const files = g.files.filter((p) => present.has(p));
    if (g.entry_path == null) {
      unrecorded = files;
    } else if (files.length > 0) {
      recorded.push({ ...g, files });
    }
  }
  unrecorded = [...unrecorded].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
  return { known: true, unrecorded, groups: recorded };
}

/** 화면에 보이는 순서의 파일 경로들 — j/k 이동이 따른다. 펼친 묶음의 파일만 센다. */
export function visiblePaths(
  buckets: ChangeBuckets,
  changes: readonly RecentChange[],
  open: ReadonlySet<string>,
): string[] {
  if (!buckets.known) return changes.map((c) => c.path).reverse();
  return [
    ...buckets.unrecorded,
    ...buckets.groups.flatMap((g) => (open.has(groupKey(g)) ? g.files : [])),
  ];
}

export function groupKey(g: ChangeGroup): string {
  return g.entry_path ?? "__untracked";
}

/** 에이전트에게 붙여 넣을 「이 변경을 일지로 남겨 달라」 요청에 싣는 파일 수의 상한. */
const REQUEST_FILE_CAP = 40;

/**
 * 「기록 요청 복사」 가 클립보드에 넣는 글. 문장은 호출자가 i18n 으로 넘기고(`intro`·`more`),
 * 여기서는 파일 줄을 붙이는 것만 한다 — 영어 모드에 한국어가 새지 않게.
 */
export function recordRequestText(
  files: readonly string[],
  intro: string,
  more: (n: number) => string,
): string {
  const shown = files.slice(0, REQUEST_FILE_CAP);
  const lines = shown.map((p) => `- ${p}`);
  if (files.length > shown.length) lines.push(`- ${more(files.length - shown.length)}`);
  return `${intro}\n\n${lines.join("\n")}`;
}
