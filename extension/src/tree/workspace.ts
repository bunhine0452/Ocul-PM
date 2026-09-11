import * as vscode from "vscode";
import { isTracked } from "../oculpm/store";

/** `.oculpm/journal` 이 있는 워크스페이스 폴더만 — 없는 폴더는 트리에 끼지 않는다. */
export async function trackedFolders(): Promise<string[]> {
  const out: string[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (f.uri.scheme === "file" && (await isTracked(f.uri.fsPath))) {
      out.push(f.uri.fsPath);
    }
  }
  return out;
}
