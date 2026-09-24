import { createModels, InMemoryCredentialStore, type Api, type Model } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';

export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', hint: 'GPT / o 系列', factory: openaiProvider },
  { id: 'anthropic', name: 'Anthropic', hint: 'Claude 系列', factory: anthropicProvider },
  { id: 'google', name: 'Google Gemini', hint: 'Gemini 系列', factory: googleProvider },
  { id: 'openrouter', name: 'OpenRouter', hint: '聚合模型', factory: openrouterProvider },
  { id: 'deepseek', name: 'DeepSeek', hint: 'DeepSeek 系列', factory: deepseekProvider },
  { id: 'xai', name: 'xAI', hint: 'Grok 系列', factory: xaiProvider },
  { id: 'mistral', name: 'Mistral', hint: 'Mistral 系列', factory: mistralProvider },
  { id: 'groq', name: 'Groq', hint: '高速推理', factory: groqProvider },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];
export type ProviderSettings = { providerId: ProviderId; modelId: string };

const credentials = new InMemoryCredentialStore();
export const models = createModels({
  credentials,
  authContext: { env: async () => undefined, fileExists: async () => false },
});

for (const provider of PROVIDERS) models.setProvider(provider.factory());

export function getProviderModels(providerId: ProviderId): readonly Model<Api>[] {
  return models.getModels(providerId);
}

export function getSelectedModel(settings: ProviderSettings): Model<Api> | undefined {
  return models.getModel(settings.providerId, settings.modelId);
}

export async function setApiKey(providerId: ProviderId, key: string): Promise<void> {
  if (key.trim()) {
    await credentials.modify(providerId, async () => ({ type: 'api_key', key: key.trim() }));
    sessionStorage.setItem(`pi-browser:key:${providerId}`, key.trim());
  } else {
    await credentials.delete(providerId);
    sessionStorage.removeItem(`pi-browser:key:${providerId}`);
  }
}

export async function restoreApiKeys(): Promise<void> {
  await Promise.all(PROVIDERS.map(async ({ id }) => {
    const key = sessionStorage.getItem(`pi-browser:key:${id}`);
    if (key) await credentials.modify(id, async () => ({ type: 'api_key', key }));
  }));
}

export function hasApiKey(providerId: ProviderId): boolean {
  return Boolean(sessionStorage.getItem(`pi-browser:key:${providerId}`));
}

export function readSettings(): ProviderSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('pi-browser:settings') || '{}') as Partial<ProviderSettings>;
    const providerId = PROVIDERS.some((item) => item.id === saved.providerId) ? saved.providerId! : 'openai';
    const available = getProviderModels(providerId);
    const modelId = available.some((item) => item.id === saved.modelId) ? saved.modelId! : available[0]?.id || '';
    return { providerId, modelId };
  } catch {
    return { providerId: 'openai', modelId: getProviderModels('openai')[0]?.id || '' };
  }
}

export function saveSettings(settings: ProviderSettings): void {
  localStorage.setItem('pi-browser:settings', JSON.stringify(settings));
}
