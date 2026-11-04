/**
 * 창 정리 (11-04) — 최근에 쓴 창 2~6개를 화면에 칸으로 세운다(`commands/window/tile.rs`).
 *
 * 처음엔 「창 N개 나란히 놓기」 하나였다 — 열린 창 전부를 같은 폭으로. 창이 여섯이면 여섯 줄기가 되고, 둘만
 * 나란히 보고 싶어도 고를 수 없었다. 이제 몇 개를 정리할지 고른다: 2 반반 · 3 세로 셋 · 4 네 칸 · 5 위 셋 아래
 * 둘 · 6 셋씩 두 줄. 단추마다 그 칸 모양을 작게 그린다 — 숫자보다 모양이 먼저 읽힌다. 열린 창보다 많은 수는
 * 서 있되 누를 수 없고, 툴팁이 왜인지 말한다(`blocked`). ⌥⌘T 는 6개까지 전부.
 */
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";

export const TILE_COUNTS = [2, 3, 4, 5, 6] as const;

/** 그 수의 칸 — [열, 행, 너비, 높이] (6×4 격자 위). `tile.rs` 의 `preferred_cols` 와 같은 모양. */
const CELLS: Record<number, [number, number, number, number][]> = {
  2: [[0, 0, 3, 4], [3, 0, 3, 4]],
  3: [[0, 0, 2, 4], [2, 0, 2, 4], [4, 0, 2, 4]],
  4: [[0, 0, 3, 2], [3, 0, 3, 2], [0, 2, 3, 2], [3, 2, 3, 2]],
  5: [[0, 0, 2, 2], [2, 0, 2, 2], [4, 0, 2, 2], [0, 2, 3, 2], [3, 2, 3, 2]],
  6: [[0, 0, 2, 2], [2, 0, 2, 2], [4, 0, 2, 2], [0, 2, 2, 2], [2, 2, 2, 2], [4, 2, 2, 2]],
};

/** 칸 모양 — 20×14 안에 1px 틈을 둔 사각형들. 색은 글자색(currentColor). */
function TileGlyph({ n }: { n: number }) {
  const ux = 20 / 6;
  const uy = 14 / 4;
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
      {CELLS[n].map(([c, r, w, h], i) => (
        <rect
          key={i}
          x={c * ux + 0.5}
          y={r * uy + 0.5}
          width={w * ux - 1}
          height={h * uy - 1}
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

export function TileChoices({ open, onTile }: { open: number; onTile: (n: number) => void }) {
  const { t } = useT();
  return (
    <div className="proj-tiles" role="group" aria-label={t("sidebar.tileWindows")}>
      <span className="proj-colors-label">{t("sidebar.tileWindows")}</span>
      {TILE_COUNTS.map((n) => (
        <button
          key={n}
          type="button"
          role="menuitem"
          className="proj-tile"
          aria-label={t("sidebar.tileN", { n })}
          {...blocked(n > open ? t("sidebar.tileNeedMore", { n }) : null, t("sidebar.tileN", { n }))}
          onClick={() => onTile(n)}
        >
          <TileGlyph n={n} />
        </button>
      ))}
      {isMac() ? <kbd className="kbd proj-pop-key">{kbd("⌥⌘T")}</kbd> : null}
    </div>
  );
}
