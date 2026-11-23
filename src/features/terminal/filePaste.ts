/**
 * Finder · 탐색기에서 복사한 파일을 ⌘V — 경로를 붙인다 (love-round 11-23). 바깥 터미널(Terminal.app · iTerm)과
 * 같은 동작이고, 끌어다 놓기(`dropFiles.ts`)와 같은 따옴표 · 정화 길을 지난다.
 *
 * 브라우저의 붙여넣기 사건은 파일 경로를 글로 주지 않는다 — 파일 이름 글자나 아이콘 그림만 와서, 예전에는 이름만
 * 붙거나 아무것도 안 붙었다. 경로는 OS 클립보드에서 읽는다: macOS · Windows 는 백엔드(`terminal_clipboard.rs`),
 * Linux 데스크톱은 붙여넣기 사건의 `text/uri-list`. 파일이 아니었으면(스크린숏 그림 등) 빈 글을 돌려주고, 부르는
 * 쪽(`pasteSafe.handlePaste`)이 예전 길(글 · 그림 붙여넣기 키)로 간다.
 */
import { terminalApi } from "@/api/terminal";
import { oculpmLog } from "@/lib/oculpmLog";
import { dropText } from "./dropFiles";

/** 한 번에 붙이는 경로 수의 상한 — 백엔드(`terminal_clipboard::MAX_PATHS`)와 같다. */
const MAX_PATHS = 64;

/** 파일을 실은 클립보드인가 — 웹뷰는 복사한 파일을 `Files` 형식(또는 Linux 의 `text/uri-list`)으로 보인다. */
export function hasCopiedFiles(data: DataTransfer): boolean {
  if (Array.from(data.types ?? []).some((type) => type === "Files" || type === "text/uri-list")) return true;
  return (data.files?.length ?? 0) > 0;
}

/** `text/uri-list` 의 `file://` 줄들 → 경로. 주석(`#`) · 다른 스킴 · 깨진 줄은 건너뛴다. */
export function pathsFromUriList(list: string): string[] {
  const out: string[] = [];
  for (const line of list.split(/\r?\n/)) {
    const uri = line.trim();
    if (!uri.startsWith("file://")) continue;
    try {
      const url = new URL(uri);
      if (url.host && url.host !== "localhost") continue; // 다른 기계의 파일
      out.push(decodeURIComponent(url.pathname));
    } catch {
      // 깨진 줄 — 건너뛴다
    }
  }
  return out.slice(0, MAX_PATHS);
}

/**
 * 붙여넣기 사건의 클립보드 → 붙일 경로 글(끝에 빈칸 하나, `dropText`). 파일을 실은 클립보드가 아니면 `null` — 사건을
 * 받은 자리에서 곧바로 가른다. 실었는데 경로를 못 얻으면(그림만 · 읽기 실패) 빈 글.
 */
export function copiedFilesText(
  data: DataTransfer,
  windows: boolean,
  read: () => Promise<string[]> = terminalApi.clipboardFiles,
): Promise<string> | null {
  if (!hasCopiedFiles(data)) return null;
  const listed = pathsFromUriList(data.getData("text/uri-list") ?? "");
  // 읽기 실패(클립보드를 다른 앱이 쥠 등)는 예전 글 붙여넣기로 — 다만 까닭은 로그에 남긴다.
  const paths =
    listed.length > 0
      ? Promise.resolve(listed)
      : read().catch((e: unknown) => {
          oculpmLog.warn("terminal", "clipboard file paths unreadable", { error: String(e) });
          return [] as string[];
        });
  return paths.then((p) => dropText(p, windows));
}
