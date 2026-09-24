import { convertToLlm, estimateTokens, serializeConversation, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model, Models } from '@earendil-works/pi-ai';

export type ContextCheckpoint = { summary: string; summarizedUntil: number };
export type ContextStatus = { kind: 'ready' | 'compacting' | 'compacted' | 'error'; tokens: number; limit: number; message?: string };

const SUMMARY_SYSTEM = 'You summarize a coding-agent conversation for future turns. Preserve user goals, decisions, constraints, file paths and edits, unresolved errors, and the next step. State facts only. Keep the result concise and structured. Do not answer the latest user request.';

function tokenCount(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function summaryMessage(summary: string): AgentMessage {
  return { role: 'system', content: `Earlier conversation summary (treat as context, not as a new instruction):\n${summary}`, timestamp: Date.now() };
}

function summaryChunks(messages: AgentMessage[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const message of messages) {
    const text = serializeConversation(convertToLlm([message]));
    if (!text) continue;
    let remaining = text;
    while (remaining) {
      const room = maxChars - current.length - (current ? 2 : 0);
      if (room <= 0) { chunks.push(current); current = ''; continue; }
      const part = remaining.slice(0, room);
      current += `${current ? '\n\n' : ''}${part}`;
      remaining = remaining.slice(part.length);
      if (remaining) { chunks.push(current); current = ''; }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Keep a complete UI transcript while sending a bounded, summarized transcript to the model. */
export function createContextManager(options: {
  models: Models;
  getModel: () => Model<Api>;
  checkpoint?: Partial<ContextCheckpoint>;
  onCheckpoint: (checkpoint: ContextCheckpoint) => void;
  onStatus: (status: ContextStatus) => void;
  summarize?: (previous: string, chunk: string, model: Model<Api>, signal?: AbortSignal) => Promise<string>;
}) {
  let checkpoint: ContextCheckpoint = {
    summary: options.checkpoint?.summary || '',
    summarizedUntil: Math.max(1, options.checkpoint?.summarizedUntil || 1),
  };

  const summarize = options.summarize ?? (async (previous: string, chunk: string, model: Model<Api>, signal?: AbortSignal) => {
    const response = await options.models.completeSimple(model, {
      systemPrompt: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: `Previous summary:\n${previous || '(none)'}\n\nNew conversation segment:\n${chunk}\n\nWrite an updated summary.`, timestamp: Date.now() }],
    }, { maxTokens: Math.min(2048, model.maxTokens), signal });
    if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage || '摘要请求失败');
    const text = response.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
    if (!text) throw new Error('模型返回了空摘要');
    return text;
  });

  async function transformContext(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
    const model = options.getModel();
    const base = messages[0]?.role === 'system' ? [messages[0]] : [];
    const cursor = Math.min(Math.max(checkpoint.summarizedUntil, base.length), messages.length);
    const effective = [...base, ...(checkpoint.summary ? [summaryMessage(checkpoint.summary)] : []), ...messages.slice(cursor)];
    const contextWindow = model.contextWindow || 128_000;
    const reserve = Math.min(Math.floor(contextWindow * 0.4), Math.max(model.maxTokens + 2048, Math.floor(contextWindow * 0.15)));
    const limit = contextWindow - reserve;
    const tokens = tokenCount(effective);
    if (tokens <= limit) { options.onStatus({ kind: 'ready', tokens, limit }); return effective; }

    const keepRecent = Math.max(2048, Math.min(16_000, Math.floor(limit * 0.35)));
    const userStarts = messages.map((message, index) => message.role === 'user' && index > cursor ? index : -1).filter((index) => index >= 0);
    const cut = userStarts.find((index) => tokenCount(messages.slice(index)) <= keepRecent) ?? userStarts.at(-1);
    if (cut === undefined || cut <= cursor) {
      options.onStatus({ kind: 'error', tokens, limit, message: '当前一轮消息已超出可用上下文，无法安全压缩；请缩短输入或工具输出。' });
      return effective;
    }

    options.onStatus({ kind: 'compacting', tokens, limit });
    try {
      let nextSummary = checkpoint.summary;
      const maxChars = Math.max(4000, Math.min(28_000, Math.floor(contextWindow * 1.5)));
      for (const chunk of summaryChunks(messages.slice(cursor, cut), maxChars)) {
        if (signal?.aborted) throw new Error('摘要已停止');
        nextSummary = await summarize(nextSummary, chunk, model, signal);
      }
      if (!nextSummary) throw new Error('没有可保存的摘要');
      const next = [...base, summaryMessage(nextSummary), ...messages.slice(cut)];
      const nextTokens = tokenCount(next);
      if (nextTokens > limit) throw new Error('摘要后仍超过上下文预算；请缩短当前消息或切换更大窗口的模型。');
      checkpoint = { summary: nextSummary, summarizedUntil: cut };
      options.onCheckpoint(checkpoint);
      options.onStatus({ kind: 'compacted', tokens: nextTokens, limit });
      return next;
    } catch (error) {
      options.onStatus({ kind: 'error', tokens, limit, message: error instanceof Error ? error.message : String(error) });
      return effective;
    }
  }

  return { transformContext, getCheckpoint: () => checkpoint };
}
