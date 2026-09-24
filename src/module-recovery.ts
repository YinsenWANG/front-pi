const RELOAD_AT_KEY = 'pi-browser:module-reload-at';
const RECOVERY_NOTICE_KEY = 'pi-browser:module-recovery-notice';

export function isModuleLoadError(error: unknown): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(error));
}

export function takeRecoveryNotice(): string {
  const notice = sessionStorage.getItem(RECOVERY_NOTICE_KEY) || '';
  sessionStorage.removeItem(RECOVERY_NOTICE_KEY);
  return notice;
}

export async function recoverModuleLoadError(error: unknown): Promise<'other' | 'reloading' | 'unavailable' | 'repeated'> {
  if (!isModuleLoadError(error)) return 'other';

  try {
    const response = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return 'unavailable';
  } catch {
    return 'unavailable';
  }

  const lastReload = Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0);
  if (Date.now() - lastReload < 15_000) return 'repeated';

  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  sessionStorage.setItem(RECOVERY_NOTICE_KEY, '页面资源已更新，请重试刚才的操作。');
  window.location.reload();
  return 'reloading';
}

export function moduleLoadMessage(result: 'unavailable' | 'repeated'): string {
  return result === 'unavailable'
    ? '页面资源无法加载。请确认网站服务仍在运行，然后刷新页面。'
    : '页面资源仍无法加载。请强制刷新页面后重试。';
}
