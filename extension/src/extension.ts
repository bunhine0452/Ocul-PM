// Ocul-PM VS Code 확장 진입점.
//
// 규칙(.claude/rules/vscode-extension.md): `.oculpm` 쓰기는 설치된 앱의
// `oculpm-mcp` 를 통해서만, 웹뷰 없음, 아웃바운드 0 — 외부 링크는 사용자
// 클릭에만 `openExternal`. 바이너리가 없으면 **읽기 전용**으로 활성화한다:
// 컨텍스트 키 `oculpm.readOnly` 가 쓰기 커맨드를 팔레트에서 숨기고
// (`package.json` menus.commandPalette `when`), 상태바가 이유를 말한다.
import * as vscode from "vscode";
import { findOculpmMcp, type BinaryProbe } from "./binary";
import { registerTreeCommands } from "./tree/commands";
import { JournalTreeProvider } from "./tree/journalTree";
import { PlanTreeProvider } from "./tree/planTree";
import { wireCheckboxes } from "./tree/toggle";
import { startWatching } from "./tree/watcher";
import { McpPool } from "./mcp/pool";
import { registerMcpProvider, type McpProviderHandle } from "./mcp/provider";
import { injectRules, pickRoot } from "./injectRules";
import { registerCursorMcp } from "./cursor/register";
import { registerUriHandler } from "./uriHandler";
import { hasMcpProviderApi } from "./mcp/provider";

export const WEBSITE = "https://oculpm.com";
export const READ_ONLY_CONTEXT = "oculpm.readOnly";
/** `vscode.lm` MCP 공급자 API 유무 — 없으면(Cursor 등) `.cursor/mcp.json` 커맨드를 판다. */
export const MCP_API_CONTEXT = "oculpm.mcpProviderApi";

/** 테스트·다른 모듈이 읽는 확장 상태 (`ext.exports`). */
export interface ExtensionState {
  readonly readOnly: boolean;
  readonly binary: BinaryProbe;
  /** 트리 공급자 — 테스트가 `getChildren` 으로 개수를 센다. */
  readonly trees: { journal: JournalTreeProvider; plans: PlanTreeProvider };
  /** 루트별 oculpm-mcp 클라이언트 — 읽기 전용이면 null. */
  readonly clientFor: (root: string) => import("./mcp/client").OculpmMcpClient | null;
  /** MCP 공급자 핸들 — `vscode.lm` 이 없는 포크에서는 null. */
  readonly mcp: () => McpProviderHandle | null;
  /** URI 핸들러의 본체 — 테스트가 `vscode://` 왕복 없이 직접 부른다. */
  readonly openEntry: (entryAbs: string) => Promise<boolean>;
  /** 트리 뷰 — 테스트가 selection 을 읽는다. */
  readonly views: { journal: vscode.TreeView<import("./tree/journalTree").JournalNode> };
}

const pool = new McpPool();
// 순환: 트리는 읽기 전용 여부를 상태에서, 상태는 트리를 담는다 — 가변 필드로 푼다.
let readOnly = true;
let binary: BinaryProbe = { path: null, source: null, tried: [] };
const trees = { journal: new JournalTreeProvider(), plans: new PlanTreeProvider(() => readOnly) };

/** `ext.exports` 는 활성화 시점의 객체를 붙들므로 스냅샷이 아니라 **살아 있는 뷰**를 내보낸다. */
const liveState: ExtensionState = {
  get readOnly() {
    return readOnly;
  },
  get binary() {
    return binary;
  },
  trees,
  clientFor: (root: string) => pool.for(root),
  mcp: () => mcpHandle,
  openEntry: (abs) => openEntryFn(abs),
  get views() {
    return { journal: journalViewRef! };
  },
};
let journalViewRef: vscode.TreeView<import("./tree/journalTree").JournalNode> | null = null;
let mcpHandle: McpProviderHandle | null = null;
let openEntryFn: (entryAbs: string) => Promise<boolean> = async () => false;

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionState> {
  const status = vscode.window.createStatusBarItem("ocul-pm.readOnly", vscode.StatusBarAlignment.Left, 0);
  status.name = "Ocul-PM";
  status.command = "ocul-pm.openWebsite";
  context.subscriptions.push(status);

  let mcpProvider: McpProviderHandle | null = null;
  const refresh = async () => {
    const setting = vscode.workspace.getConfiguration("oculpm").get<string>("mcpBinaryPath");
    binary = await findOculpmMcp(setting);
    readOnly = binary.path === null;
    pool.setBinary(binary.path);
    trees.plans.refresh();
    mcpProvider?.fire();
    await vscode.commands.executeCommand("setContext", READ_ONLY_CONTEXT, readOnly);
    if (readOnly) {
      status.text = "$(circle-slash) Ocul-PM 읽기 전용";
      status.tooltip = new vscode.MarkdownString(
        "Ocul-PM 앱의 `oculpm-mcp` 를 찾지 못해 일지·플랜은 **읽기만** 됩니다.\n\n" +
          "앱을 설치하거나 설정 `oculpm.mcpBinaryPath` 를 지정하세요.\n\n" +
          "살펴본 경로:\n" + binary.tried.map((t) => `- \`${t}\``).join("\n") +
          "\n\n클릭 → oculpm.com",
      );
      status.show();
    } else {
      status.hide();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("ocul-pm.openWebsite", () =>
      vscode.env.openExternal(vscode.Uri.parse(WEBSITE)),
    ),
    vscode.commands.registerCommand("ocul-pm.rescanBinary", refresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("oculpm.mcpBinaryPath")) {
        void refresh();
      }
    }),
  );

  const planView = vscode.window.createTreeView("oculpm.plans", { treeDataProvider: trees.plans, showCollapseAll: true, manageCheckboxStateManually: true });
  const journalView = vscode.window.createTreeView("oculpm.journal", { treeDataProvider: trees.journal, showCollapseAll: true });
  journalViewRef = journalView;
  openEntryFn = registerUriHandler(context, journalView);
  context.subscriptions.push(
    pool,
    journalView,
    planView,
    wireCheckboxes(planView, (root) => pool.for(root), () => trees.plans.refresh()),
  );
  const refreshTrees = () => {
    trees.journal.refresh();
    trees.plans.refresh();
  };
  registerTreeCommands(context, refreshTrees);
  startWatching(context, refreshTrees);
  mcpProvider = registerMcpProvider(context, () => binary.path);
  mcpHandle = mcpProvider;
  await vscode.commands.executeCommand("setContext", MCP_API_CONTEXT, hasMcpProviderApi());
  context.subscriptions.push(
    vscode.commands.registerCommand("ocul-pm.registerCursorMcp", async () => {
      const root = await pickRoot();
      if (root) {
        await registerCursorMcp(binary.path, root);
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("ocul-pm.injectRules", async () => {
      const root = await pickRoot();
      if (root) {
        await injectRules((r) => pool.for(r), root);
      }
    }),
  );

  await refresh();
  return liveState;
}

export function deactivate(): void {}
