// 체크박스 토글 → oculpm-mcp `plan_status`(hash) → `plan_update(base_hash)`.
// 파일을 직접 고치지 않는다 — 글리프 교체·plan-log 행·잠금·CAS 는 서버 규격.
// 충돌(다른 세션이 그 사이 고침)은 한 번 다시 읽어 재시도하고, 그래도 안 되면
// 토스트 + 트리 갱신(체크박스가 디스크 상태로 되돌아간다).
import * as vscode from "vscode";
import { McpToolError, type OculpmMcpClient } from "../mcp/client";
import type { ItemStatus } from "../oculpm/planner";
import type { PlanNode } from "./planTree";

interface PlanStatusResult {
  plans: { id: string; hash: string }[];
}
interface PlanUpdateResult {
  plan_id: string;
  item_id: string;
  from: string;
  to: string;
  hash: string;
}

export async function applyToggle(
  client: OculpmMcpClient,
  planId: string,
  itemId: string,
  checked: boolean,
): Promise<PlanUpdateResult> {
  const status: ItemStatus = checked ? "done" : "todo";
  const update = async (baseHash: string) =>
    client.callTool<PlanUpdateResult>("plan_update", {
      plan_id: planId,
      item_id: itemId,
      status,
      base_hash: baseHash,
      note: "VS Code 체크박스",
    });
  try {
    return await update(await readHash(client, planId));
  } catch (e) {
    if (e instanceof McpToolError && e.isConflict) {
      // 병렬 세션이 고쳤다 — 한 번 다시 읽고 재시도.
      return await update(await readHash(client, planId));
    }
    throw e;
  }
}

async function readHash(client: OculpmMcpClient, planId: string): Promise<string> {
  const r = await client.callTool<PlanStatusResult>("plan_status", { plan_id: planId, limit: 1 });
  const hash = r.plans.find((p) => p.id === planId)?.hash;
  if (!hash) {
    throw new Error(`플랜 '${planId}' 의 hash 를 읽지 못했습니다 (잠겼거나 없음)`);
  }
  return hash;
}

export function wireCheckboxes(
  view: vscode.TreeView<PlanNode>,
  clientFor: (root: string) => OculpmMcpClient | null,
  refresh: () => void,
): vscode.Disposable {
  return view.onDidChangeCheckboxState(async (e) => {
    for (const [node, state] of e.items) {
      if (node.kind !== "item") {
        continue;
      }
      const client = clientFor(node.root);
      if (!client) {
        void vscode.window.showWarningMessage("읽기 전용 — Ocul-PM 앱의 oculpm-mcp 를 찾지 못했습니다.");
        refresh();
        continue;
      }
      const checked = state === vscode.TreeItemCheckboxState.Checked;
      try {
        const r = await applyToggle(client, node.file.plan.id, node.item.itemId, checked);
        vscode.window.setStatusBarMessage(`Ocul-PM: #${r.item_id} ${r.from}→${r.to}`, 3000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`플랜 항목을 갱신하지 못했습니다: ${msg}`);
      }
      // 성공이면 워처가 곧 갱신하지만, 실패했을 때 체크박스를 디스크 상태로 되돌리려면 직접 한 번.
      refresh();
    }
  });
}
