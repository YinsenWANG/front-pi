import { WebContainer } from '@webcontainer/api';
import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export const WORKSPACE = '/workspace';
let instancePromise: Promise<WebContainer> | undefined;
type SavedFile = { path: string; bytes: Uint8Array };

function snapshotDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pi-browser-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSnapshot(): Promise<SavedFile[] | undefined> {
  const db = await snapshotDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('workspace');
    request.onsuccess = () => { db.close(); resolve(request.result as SavedFile[] | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function saveSnapshot(): Promise<void> {
  if (!instancePromise) return;
  const wc = await instancePromise;
  const snapshot: SavedFile[] = [];
  async function collect(directory: string): Promise<void> {
    const entries = await wc.fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) snapshot.push({ path: path.slice(WORKSPACE.length + 1), bytes: await wc.fs.readFile(path) });
    }
  }
  await collect(WORKSPACE);
  const db = await snapshotDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    transaction.objectStore('snapshots').put(snapshot, 'workspace');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export function getWorkspace(): Promise<WebContainer> {
  instancePromise ??= (async () => {
    if (!crossOriginIsolated) throw new Error('浏览器没有跨源隔离；请通过 Vite 的 localhost 地址打开。');
    const wc = await WebContainer.boot({ coep: 'credentialless' });
    await wc.fs.mkdir(WORKSPACE, { recursive: true });
    const snapshot = await readSnapshot().catch(() => undefined);
    if (snapshot?.length) {
      for (const file of snapshot) {
        const path = safePath(file.path);
        await wc.fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        await wc.fs.writeFile(path, file.bytes);
      }
    } else await wc.fs.writeFile(`${WORKSPACE}/README.md`, '# Front Pi Workspace\n\n在浏览器内使用 Pi Agent 与 WebContainer。\n');
    return wc;
  })().catch((error) => {
    instancePromise = undefined;
    throw error;
  });
  return instancePromise;
}

function safePath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (!normalized.length) throw new Error('路径必须位于 /workspace 内');
      normalized.pop();
    } else normalized.push(part);
  }
  if (normalized[0] === 'workspace') normalized.shift();
  return `${WORKSPACE}/${normalized.join('/')}`;
}

const result = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined });

async function directoryListing(path = '.'): Promise<string> {
  const wc = await getWorkspace();
  const target = safePath(path);
  const entries = await wc.fs.readdir(target, { withFileTypes: true });
  return entries.map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`).join('\n') || '(empty)';
}

export async function listFiles(path = '.'): Promise<string> {
  return directoryListing(path);
}

export async function readFile(path: string): Promise<string> {
  const wc = await getWorkspace();
  return wc.fs.readFile(safePath(path), 'utf8');
}

export async function writeFile(path: string, content: string | Uint8Array): Promise<void> {
  const wc = await getWorkspace();
  const target = safePath(path);
  await wc.fs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  await wc.fs.writeFile(target, content);
  await saveSnapshot();
}

export async function runCommand(command: string, signal?: AbortSignal): Promise<string> {
  const wc = await getWorkspace();
  const process = await wc.spawn('jsh', ['-c', command], { cwd: WORKSPACE });
  const abort = () => process.kill();
  signal?.addEventListener('abort', abort, { once: true });
  const reader = process.output.getReader();
  let output = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += value;
      if (output.length > 32_000) {
        process.kill();
        output = `${output.slice(0, 32_000)}\n[输出超过 32 KB，命令已停止]`;
        break;
      }
    }
    const code = await process.exit;
    await saveSnapshot();
    return `${output || '(no output)'}\n[exit ${code}]`;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export const workspaceTools: AgentTool<any>[] = [
  {
    name: 'list_files', label: '列出文件', description: '列出浏览器工作区目录。路径相对于 /workspace。',
    parameters: Type.Object({ path: Type.Optional(Type.String({ description: '目录路径，默认 .' })) }),
    execute: async (_id, params) => result(await directoryListing((params as { path?: string }).path)),
  },
  {
    name: 'read_file', label: '读取文件', description: '读取浏览器工作区中的 UTF-8 文本文件。',
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, params) => {
      const text = await readFile((params as { path: string }).path);
      return result(text.length > 32_000 ? `${text.slice(0, 32_000)}\n[文件内容已截断；请用命令分段读取]` : text);
    },
  },
  {
    name: 'write_file', label: '写入文件', description: '在浏览器工作区创建或覆盖 UTF-8 文本文件。',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id, params) => { const { path, content } = params as { path: string; content: string }; await writeFile(path, content); return result(`Wrote ${path}`); },
  },
  {
    name: 'edit_file', label: '编辑文件', description: '将文件中恰好出现一次的 old_text 替换为 new_text。',
    parameters: Type.Object({ path: Type.String(), old_text: Type.String(), new_text: Type.String() }),
    execute: async (_id, params) => {
      const { path, old_text, new_text } = params as { path: string; old_text: string; new_text: string };
      const content = await readFile(path);
      const count = content.split(old_text).length - 1;
      if (count !== 1) throw new Error(`Expected exactly one match; found ${count}`);
      await writeFile(path, content.replace(old_text, new_text));
      return result(`Edited ${path}`);
    },
  },
  {
    name: 'run_command', label: '执行命令', description: '在浏览器 WebContainer 的 /workspace 中执行命令。无法访问用户电脑的文件系统。',
    parameters: Type.Object({ command: Type.String() }),
    execute: async (_id, params, signal) => result(await runCommand((params as { command: string }).command, signal)),
    executionMode: 'sequential',
  },
];
