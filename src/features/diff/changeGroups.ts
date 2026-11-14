// 변경 화면의 순수 모델 (4.0) — 변경 파일을 「일지에 있음」 / 「기록 없음」 둘로 가른다.
// 렌더와 분리해 두는 이유: j/k 이동 순서가 목록에 보이는 순서와 같은 소스여야 하는데, 그 계약을
// 컴포넌트 안에 두면 테스트할 수가 없다.

import { evidenceStateOf } from "@/features/oculpm/evidenceState";
import { normalizeJournalRef } from "@/features/oculpm/useJournalPlanLinks";
import type { ChangeGroup, JournalEntrySummary } from "@/lib/bindings";
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

const NONE: ReadonlySet<string> = new Set();

/**
 * 화면에 보이는 순서의 파일 경로들 — j/k 이동이 따른다. 펼친 묶음의 파일만 센다. 잠금 · 생성 파일은
 * 제자리에서 빠지고, 끝의 「생성된 파일」 을 펼쳤을 때만 맨 뒤에 선다.
 */
export function visiblePaths(
  buckets: ChangeBuckets,
  changes: readonly RecentChange[],
  open: ReadonlySet<string>,
  generated: ReadonlySet<string> = NONE,
  generatedOpen = false,
): string[] {
  const keep = (p: string) => !generated.has(p);
  const rows = !buckets.known
    ? changes.map((c) => c.path).reverse().filter(keep)
    : [
        ...buckets.unrecorded.filter(keep),
        ...buckets.groups.flatMap((g) => (open.has(groupKey(g)) ? g.files.filter(keep) : [])),
      ];
  return generatedOpen ? [...rows, ...generatedPaths(buckets, changes, generated)] : rows;
}

/** 끝의 「생성된 파일」 에 접힌 파일들 — 원래 서던 차례대로(일지 없음 → 일지 묶음, 모르면 최신 먼저). */
export function generatedPaths(
  buckets: ChangeBuckets,
  changes: readonly RecentChange[],
  generated: ReadonlySet<string>,
): string[] {
  if (generated.size === 0) return [];
  const order = buckets.known
    ? [...buckets.unrecorded, ...buckets.groups.flatMap((g) => g.files)]
    : changes.map((c) => c.path).reverse();
  return order.filter((p) => generated.has(p));
}

export function groupKey(g: ChangeGroup): string {
  return g.entry_path ?? "__untracked";
}

/**
 * 묶음의 차례 (11-15 #diff-viewed) — 검증 없음 → 읽음 안 함 → 나머지. 두 번째 예외(검증 없는 일지)가
 * 접힌 묶음 메타 끝 작은 글자로만 서서, 차례로도 선택으로도 앞에 서지 않았다. 같은 칸 안은 백엔드
 * 차례(최신 일지 먼저) 그대로.
 */
export function groupRank(g: ChangeGroup, summary: JournalEntrySummary | undefined): number {
  if (summary && evidenceStateOf(summary) === "missing") return 0;
  if (!(g.verified_by_user && !g.verified_stale)) return 1;
  return 2;
}

export function sortGroups(
  groups: readonly ChangeGroup[],
  entries: ReadonlyMap<string, JournalEntrySummary>,
): ChangeGroup[] {
  const summaryOf = (g: ChangeGroup) => (g.entry_path ? entries.get(normalizeJournalRef(g.entry_path)) : undefined);
  return groups
    .map((g, i) => ({ g, i, rank: groupRank(g, summaryOf(g)) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.g);
}

/** 검증 없는 묶음의 열쇠들 — 처음 펼쳐 둔다. */
export function missingGroupKeys(
  groups: readonly ChangeGroup[],
  entries: ReadonlyMap<string, JournalEntrySummary>,
): string[] {
  return groups
    .filter((g) => g.entry_path && groupRank(g, entries.get(normalizeJournalRef(g.entry_path))) === 0)
    .map(groupKey);
}

/**
 * 처음 고를 파일 — 일지 없는 첫 파일, 없으면 검증 없는 첫 묶음의 첫 파일, 그것도 없으면 가장 최근에
 * 바뀐 파일. 끝에 접힌 생성 파일은 고르지 않는다(고르면 접은 줄이 다시 펼쳐진다).
 */
export function firstPick(
  buckets: ChangeBuckets,
  missing: ReadonlySet<string>,
  generated: ReadonlySet<string>,
  changes: readonly RecentChange[] = [],
): string | null {
  const keep = (p: string) => !generated.has(p);
  const loose = buckets.unrecorded.find(keep);
  if (loose) return loose;
  for (const g of buckets.groups) {
    if (!missing.has(groupKey(g))) continue;
    const f = g.files.find(keep);
    if (f) return f;
  }
  return [...changes].reverse().find((c) => keep(c.path))?.path ?? null;
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
