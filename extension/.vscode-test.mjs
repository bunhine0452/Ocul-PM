import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 워크스페이스 = 이 저장소 루트 — 트리 테스트가 실제 `.oculpm/` 을 센다.
// 단일 폴더가 아니라 `.code-workspace` 로 여는 이유: 단일 폴더 창에 폴더를 더하면
// VS Code 가 "untitled workspace" 로 **창을 다시 열어** 테스트가 끊긴다. 처음부터
// 멀티루트 파일이면 `updateWorkspaceFolders` 가 제자리에서 동작한다.
const repo = path.resolve(import.meta.dirname, '..');
const wsFile = path.join(import.meta.dirname, '.vscode-test', 'repo.code-workspace');
mkdirSync(path.dirname(wsFile), { recursive: true });
writeFileSync(wsFile, JSON.stringify({ folders: [{ path: repo }], settings: {} }, null, 2));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: wsFile,
	launchArgs: ['--disable-extensions'],
});
