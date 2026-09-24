import { useEffect, useMemo, useRef, useState } from 'react';
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, CircleAlert, Code2, Command, FileCode2,
  Files, FolderOpen, KeyRound, LoaderCircle, Menu, MessageSquare, MoreHorizontal,
  PanelRightClose, PanelRightOpen, Plus, RotateCcw, Search, Settings2, ShieldCheck,
  Sparkles, Square, Terminal, Trash2, Upload, X,
} from 'lucide-react';
import { getProviderModels, getSelectedModel, hasApiKey, models, PROVIDERS, readSettings, restoreApiKeys, saveSettings, setApiKey, type ProviderId, type ProviderSettings } from './providers';
import { getWorkspace, listFiles, readFile, runCommand, workspaceTools, writeFile } from './workspace';
import { createContextManager, type ContextStatus } from './context';
import { isModuleLoadError, moduleLoadMessage, recoverModuleLoadError, takeRecoveryNotice } from './module-recovery';

type Session = { id: string; title: string; createdAt: number; updatedAt: number; messages: AgentMessage[]; summary?: string; summarizedUntil?: number };
type WorkspaceStatus = 'loading' | 'ready' | 'error';

const SYSTEM_PROMPT = `You are Pi, a coding agent running entirely in the user's browser. Your tools operate on an isolated WebContainer at /workspace. Be concise. Inspect files before editing. Explain the result and any command failures. You cannot access the host computer unless the user uploads files into the workspace. Browser network requests and model APIs may be limited by CORS.`;
const STORAGE_KEY = 'pi-browser:sessions:v1';

function newSession(): Session {
  return { id: crypto.randomUUID(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
}

function loadSessions(): Session[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Session[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages)) : [];
  } catch { return []; }
}

function contentText(message: AgentMessage): string {
  if (!('content' in message)) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.map((part) => {
    if (part.type === 'text') return part.text;
    if (part.type === 'thinking') return part.thinking;
    if (part.type === 'toolCall') return '';
    return '';
  }).filter(Boolean).join('\n');
}

function Message({ message }: { message: AgentMessage }) {
  if (message.role === 'system') return null;
  if (message.role === 'toolResult') {
    const text = contentText(message);
    return <div className="tool-result"><span className="tool-result-icon"><Terminal size={14} /></span><div><strong>{message.toolName}</strong><pre>{text}</pre></div></div>;
  }
  const isUser = message.role === 'user';
  const text = contentText(message);
  const calls = message.role === 'assistant' && Array.isArray(message.content)
    ? message.content.filter((part) => part.type === 'toolCall') : [];
  const rawError = message.role === 'assistant' && message.stopReason === 'error' ? message.errorMessage : '';
  const error = isModuleLoadError(rawError) ? '页面资源加载失败，请刷新页面后重试。' : rawError;
  if (!text && calls.length === 0 && !error) return null;
  return <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
    {!isUser && <div className="message-avatar"><Sparkles size={15} /></div>}
    <div className="message-body">
      <div className="message-author">{isUser ? '你' : 'Pi Agent'}</div>
      {text && <div className="message-text">{text}</div>}
      {calls.map((call) => <div className="tool-call" key={call.id}><Code2 size={14} /><strong>{call.name}</strong><code>{JSON.stringify(call.arguments)}</code></div>)}
      {error && <div className="message-error"><CircleAlert size={14} />{error}</div>}
    </div>
  </div>;
}

function ProviderDialog({ settings, onSettings, onClose }: { settings: ProviderSettings; onSettings: (value: ProviderSettings) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<ProviderId>(settings.providerId);
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(() => new Set(PROVIDERS.filter((p) => hasApiKey(p.id)).map((p) => p.id)));
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const provider = PROVIDERS.find((item) => item.id === selected)!;
  const catalog = getProviderModels(selected);
  const filtered = catalog.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80);

  async function saveKey() {
    await setApiKey(selected, key);
    setConfigured(new Set(PROVIDERS.filter((p) => hasApiKey(p.id)).map((p) => p.id)));
    setKey(''); setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function chooseModel(modelId: string) {
    const next = { providerId: selected, modelId };
    onSettings(next); saveSettings(next);
  }

  async function testConnection() {
    if (!hasApiKey(selected)) { setTestStatus('请先保存 API Key。'); return; }
    const model = settings.providerId === selected
      ? getSelectedModel(settings) || catalog[0]
      : catalog[0];
    if (!model) { setTestStatus('这个 Provider 没有可测试的模型。'); return; }
    setTesting(true); setTestStatus('正在连接…');
    try {
      const response = await models.completeSimple(model, {
        messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
      }, { maxTokens: 16, timeoutMs: 15_000, maxRetries: 0 });
      if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage || '模型请求失败');
      setTestStatus(`连接成功 · ${model.name}`);
    } catch (error) {
      const recovery = await recoverModuleLoadError(error);
      setTestStatus(recovery === 'reloading' ? '页面资源已更新，正在重新加载…'
        : recovery === 'unavailable' || recovery === 'repeated' ? moduleLoadMessage(recovery)
        : `连接失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setTesting(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Provider 设置">
      <div className="settings-header"><div><span className="eyebrow">MODEL CONNECTIONS</span><h2>Provider 设置</h2><p>连接模型服务，选择本次对话使用的模型。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
      <div className="settings-grid">
        <div className="provider-list">{PROVIDERS.map((item) => <button key={item.id} className={`provider-row ${selected === item.id ? 'selected' : ''}`} onClick={() => { setSelected(item.id); setKey(''); setQuery(''); }}><span className="provider-monogram">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.hint}</small></span>{configured.has(item.id) && <span className="provider-dot" />}</button>)}</div>
        <div className="provider-detail">
          <div className="provider-detail-title"><div className="provider-large-icon">{provider.name.slice(0, 1)}</div><div><h3>{provider.name}</h3><p>{catalog.length} 个 Pi 模型可选</p></div></div>
          <label className="field-label" htmlFor="api-key">API Key</label>
          <div className="key-row"><input id="api-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured.has(selected) ? '已在当前浏览器会话中保存' : '粘贴你的 API Key'} autoComplete="off" /><button className="primary small" onClick={saveKey}>{saved ? <Check size={15} /> : <KeyRound size={15} />}{saved ? '已保存' : '保存'}</button></div>
          <div className="connection-row"><button className="text-button" onClick={() => void testConnection()} disabled={testing}>测试连接</button>{testStatus && <span>{testStatus}</span>}</div>
          <p className="help-text"><ShieldCheck size={13} /> Key 只保存在本标签页的 sessionStorage，并直接发送给 Provider。浏览器请求需由 Provider 允许 CORS。</p>
          {configured.has(selected) && <button className="text-button danger" onClick={async () => { await setApiKey(selected, ''); setConfigured(new Set(PROVIDERS.filter((p) => hasApiKey(p.id)).map((p) => p.id))); }}>清除此 Provider 的 Key</button>}
          <div className="divider" />
          <div className="model-heading"><div><label className="field-label">模型目录</label><span>{settings.providerId === selected ? `当前：${settings.modelId}` : '选择模型以切换 Provider'}</span></div></div>
          <div className="model-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模型名称或 ID" /></div>
          <div className="model-list">{filtered.map((model) => <button className={`model-row ${settings.providerId === selected && settings.modelId === model.id ? 'active' : ''}`} key={model.id} onClick={() => chooseModel(model.id)}><span><strong>{model.name}</strong><small>{model.id}</small></span>{settings.providerId === selected && settings.modelId === model.id && <Check size={17} />}</button>)}{filtered.length === 0 && <div className="empty-list">没有匹配的模型</div>}</div>
        </div>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(() => loadSessions()[0]?.id || newSession().id);
  const [settings, setSettings] = useState<ProviderSettings>(readSettings);
  const settingsRef = useRef(settings);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState<AgentMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [moduleNotice, setModuleNotice] = useState(takeRecoveryNotice);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(() => window.innerWidth > 900);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>('loading');
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<'files' | 'terminal'>('files');
  const [fileList, setFileList] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalOutput, setTerminalOutput] = useState('Front Pi · /workspace\n');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const agentRef = useRef<Agent | null>(null);
  const activeIdRef = useRef(activeId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((item) => item.id === activeId);
  const selectedModel = getSelectedModel(settings);
  const selectedProvider = PROVIDERS.find((item) => item.id === settings.providerId)!;
  const visibleMessages = useMemo(() => [...messages.filter((message) => message.role !== 'system'), ...(streaming ? [streaming] : [])], [messages, streaming]);

  useEffect(() => { settingsRef.current = settings; if (agentRef.current && selectedModel) agentRef.current.state.model = selectedModel; }, [settings, selectedModel]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visibleMessages.length, streaming]);

  useEffect(() => {
    restoreApiKeys().catch(console.error);
    getWorkspace().then(async () => { setWorkspaceStatus('ready'); setFileList(await listFiles()); }).catch((error: unknown) => { setWorkspaceStatus('error'); setWorkspaceError(error instanceof Error ? error.message : String(error)); });
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
    const session = sessions.find((item) => item.id === activeId);
    const model = getSelectedModel(settingsRef.current);
    if (!model) return;
    const agent = new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: workspaceTools },
      streamFn: models.streamSimple.bind(models),
      toolExecution: 'sequential',
    });
    const contextManager = createContextManager({
      models,
      getModel: () => agent.state.model,
      checkpoint: session,
      onCheckpoint: (checkpoint) => setSessions((current) => current.map((item) => item.id === activeId ? { ...item, ...checkpoint } : item)),
      onStatus: setContextStatus,
    });
    agent.transformContext = contextManager.transformContext;
    if (session?.messages.length) agent.state.messages = session.messages;
    agentRef.current = agent;
    setMessages(agent.state.messages);
    setStreaming(null);
    setBusy(false);
    setContextStatus(null);
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'agent_start') setBusy(true);
      if (event.type === 'message_update') setStreaming(event.message);
      if (event.type === 'message_end') {
        setMessages([...agent.state.messages]); setStreaming(null);
        if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
          void recoverModuleLoadError(event.message.errorMessage).then((recovery) => {
            if (recovery === 'unavailable' || recovery === 'repeated') setModuleNotice(moduleLoadMessage(recovery));
          });
        }
      }
      if (event.type === 'tool_execution_end') listFiles().then(setFileList).catch(() => {});
      if (event.type === 'agent_end') {
        const snapshot = [...agent.state.messages];
        setMessages(snapshot); setStreaming(null); setBusy(false);
        setSessions((current) => current.map((item) => item.id === activeIdRef.current ? { ...item, messages: snapshot, updatedAt: Date.now() } : item));
      }
    });
    return () => { unsubscribe(); agent.abort(); if (agentRef.current === agent) agentRef.current = null; };
  }, [activeId]);

  function createChat() {
    if (busy) return;
    const session = newSession();
    setSessions((current) => [session, ...current]); setActiveId(session.id); setMobileSidebar(false);
  }

  function removeChat(id: string) {
    if (busy && id === activeId) return;
    setSessions((current) => current.filter((item) => item.id !== id));
    if (id === activeId) setActiveId(sessions.find((item) => item.id !== id)?.id || newSession().id);
  }

  async function send(text = input) {
    const prompt = text.trim();
    const agent = agentRef.current;
    if (!prompt || !agent || busy) return;
    if (!hasApiKey(settings.providerId)) { setShowSettings(true); return; }
    if (workspaceStatus !== 'ready') { setShowWorkspace(true); return; }
    if (!sessions.some((item) => item.id === activeId)) {
      setSessions((current) => [{ id: activeId, title: prompt.slice(0, 32), createdAt: Date.now(), updatedAt: Date.now(), messages: [] }, ...current]);
    } else if (!activeSession || activeSession.title === '新对话') {
      setSessions((current) => current.map((item) => item.id === activeId ? { ...item, title: prompt.slice(0, 32) } : item));
    }
    setInput(''); setBusy(true);
    setModuleNotice('');
    try { await agent.prompt(prompt); }
    catch (error) { setTerminalOutput((current) => `${current}\nAgent error: ${String(error)}`); }
    finally { setBusy(false); }
  }

  async function refreshFiles() { try { setFileList(await listFiles()); } catch (error) { setWorkspaceError(String(error)); } }
  async function openFile(name: string) {
    try { setFilePath(name); setFileContent(await readFile(name)); }
    catch { setFilePath(null); }
  }
  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) await writeFile(file.name, new Uint8Array(await file.arrayBuffer()));
    await refreshFiles();
  }
  async function terminalRun() {
    const command = terminalInput.trim(); if (!command || terminalBusy) return;
    setTerminalInput(''); setTerminalBusy(true);
    setTerminalOutput((current) => `${current}\n$ ${command}\n`);
    try { const output = await runCommand(command); setTerminalOutput((current) => `${current}${output}\n`); await refreshFiles(); }
    catch (error) { setTerminalOutput((current) => `${current}${String(error)}\n`); }
    finally { setTerminalBusy(false); }
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileSidebar ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark">π</div><div><strong>Front Pi</strong><small>浏览器里的 Agent 工作台</small></div><button className="mobile-close icon-button" onClick={() => setMobileSidebar(false)}><X size={18} /></button></div>
      <button className="new-chat" onClick={createChat}><Plus size={17} /> 新建对话 <span>⌘ K</span></button>
      <div className="sidebar-section-label">工作区</div>
      <button className="nav-item active"><MessageSquare size={17} /> Agent 对话</button>
      <button className="nav-item" onClick={() => { setShowWorkspace(true); setWorkspaceTab('files'); }}><Files size={17} /> 文件浏览器</button>
      <button className="nav-item" onClick={() => { setShowWorkspace(true); setWorkspaceTab('terminal'); }}><Terminal size={17} /> 终端</button>
      <div className="sidebar-section-label history-label">最近对话 <MoreHorizontal size={17} /></div>
      <div className="session-list">{[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((session) => <div className={`session-row ${session.id === activeId ? 'active' : ''}`} key={session.id}><button onClick={() => { if (!busy) { setActiveId(session.id); setMobileSidebar(false); } }}><MessageSquare size={15} /><span>{session.title}</span></button><button className="session-delete" onClick={() => removeChat(session.id)} aria-label="删除对话"><Trash2 size={14} /></button></div>)}</div>
      <div className="sidebar-footer"><div className="runtime-card"><span className={`status-dot ${workspaceStatus}`} /><div><strong>{workspaceStatus === 'ready' ? '浏览器运行时已就绪' : workspaceStatus === 'loading' ? '启动浏览器运行时' : '运行时不可用'}</strong><small>{workspaceStatus === 'ready' ? 'Pi Core + WebContainer' : workspaceStatus === 'error' ? workspaceError : '初始化中…'}</small></div></div><button className="footer-settings" onClick={() => setShowSettings(true)}><Settings2 size={17} /> 设置 <ChevronDown size={14} /></button></div>
    </aside>

    <main className="main-pane">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileSidebar(true)}><Menu size={19} /></button><span className="breadcrumb">工作区</span><span className="breadcrumb-slash">/</span><strong>{activeSession?.title || '新对话'}</strong></div><div className="top-actions"><button className="model-pill" onClick={() => setShowSettings(true)}><span className="model-pill-dot" />{selectedProvider.name}<span className="pill-separator">/</span><span className="model-pill-name">{selectedModel?.name || '选择模型'}</span><ChevronDown size={14} /></button><button className="icon-button panel-toggle" aria-label="切换工作区面板" onClick={() => setShowWorkspace(!showWorkspace)}>{showWorkspace ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>
      <div className="chat-scroll"><div className="chat-inner">{visibleMessages.length === 0 ? <div className="welcome"><div className="welcome-icon">π</div><span className="welcome-overline">FRONT PI</span><h1>今天想构建什么？</h1><p>在浏览器里与 Pi 协作。它可以查看工作区、编辑文件、运行命令，帮你把想法一步步做出来。</p><div className="suggestions"><button onClick={() => setInput('创建一个简洁的待办事项网页，包含 HTML、CSS 和 JavaScript。')}><Code2 size={18} /><span>做一个网页<small>从空白工作区开始</small></span><ArrowUp size={15} /></button><button onClick={() => setInput('读取工作区中的文件，并概述当前项目结构。')}><FolderOpen size={18} /><span>查看工作区<small>了解现有文件</small></span><ArrowUp size={15} /></button><button onClick={() => setInput('帮我设计一个小型项目，先列出文件结构和实现步骤。')}><Sparkles size={18} /><span>规划一个项目<small>先整理思路和步骤</small></span><ArrowUp size={15} /></button></div></div> : <div className="conversation">{visibleMessages.map((message, index) => <Message key={`${index}-${message.role}`} message={message} />)}{busy && !streaming && <div className="thinking"><LoaderCircle size={16} className="spin" /> Pi 正在工作…</div>}<div ref={bottomRef} /></div>}</div></div>
      <div className="composer-wrap">
        {moduleNotice && <div className="context-error"><CircleAlert size={14} />{moduleNotice}</div>}
        {contextStatus?.kind === 'error' && <div className="context-error"><CircleAlert size={14} />{contextStatus.message}</div>}
        <div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="给 Pi 发送消息…" rows={2} /><div className="composer-bottom"><div className="composer-meta"><span className="workspace-badge"><span className={`status-dot ${workspaceStatus}`} /> /workspace</span><span>{contextStatus?.kind === 'compacting' ? '正在压缩上下文…' : contextStatus?.kind === 'compacted' ? '上下文已压缩' : contextStatus ? `上下文约 ${Math.round(contextStatus.tokens / 1000)}k / ${Math.round(contextStatus.limit / 1000)}k` : '浏览器内执行'}</span></div><button className={`send-button ${busy ? 'stop' : ''}`} onClick={() => busy ? agentRef.current?.abort() : void send()} aria-label={busy ? '停止' : '发送'}>{busy ? <Square size={16} fill="currentColor" /> : <ArrowUp size={19} />}</button></div></div><div className="composer-note">模型请求由浏览器直连 Provider · Enter 发送 · Shift+Enter 换行</div>
      </div>
    </main>

    {showWorkspace && <aside className="workspace-pane"><div className="workspace-header"><div><span className="eyebrow">浏览器沙箱</span><h3>工作区</h3></div><button className="icon-button" aria-label="关闭面板" onClick={() => setShowWorkspace(false)}><X size={17} /></button></div><div className="workspace-tabs"><button className={workspaceTab === 'files' ? 'active' : ''} onClick={() => setWorkspaceTab('files')}><Files size={15} />文件</button><button className={workspaceTab === 'terminal' ? 'active' : ''} onClick={() => setWorkspaceTab('terminal')}><Terminal size={15} />终端</button></div>{workspaceTab === 'files' ? <div className="files-view"><div className="files-toolbar"><span><FolderOpen size={14} /> /workspace</span><div><button className="icon-button" onClick={() => uploadRef.current?.click()} title="上传文件"><Upload size={16} /></button><button className="icon-button" onClick={refreshFiles} title="刷新"><RotateCcw size={16} /></button></div><input hidden ref={uploadRef} type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} /></div>{workspaceStatus === 'error' ? <div className="workspace-error"><CircleAlert size={17} />{workspaceError}</div> : <div className="file-items">{fileList.split('\n').filter(Boolean).map((line) => { const isDir = line.startsWith('dir '); const name = line.slice(5); return <button key={line} onClick={() => !isDir && void openFile(name)}><span>{isDir ? <FolderOpen size={16} /> : <FileCode2 size={16} />}{name}</span>{!isDir && <ArrowDown size={13} className="file-chevron" />}</button>; })}</div>}{filePath && <div className="file-preview"><div><strong>{filePath}</strong><button className="icon-button" onClick={() => setFilePath(null)}><X size={15} /></button></div><pre>{fileContent}</pre></div>}<div className="workspace-tip"><Command size={15} />文件保存在当前 WebContainer 中。上传文件后可交给 Pi 编辑。</div></div> : <div className="terminal-view"><pre>{terminalOutput}</pre><div className="terminal-command"><span>$</span><input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void terminalRun(); }} placeholder="输入命令" disabled={terminalBusy || workspaceStatus !== 'ready'} /><button onClick={() => void terminalRun()} disabled={terminalBusy}><ArrowUp size={16} /></button></div></div>}</aside>}
    {showSettings && <ProviderDialog settings={settings} onSettings={setSettings} onClose={() => setShowSettings(false)} />}
  </div>;
}
