import { Plugin, requestUrl } from 'obsidian';

const reporters = new WeakMap<Plugin, (name: string, error?: unknown) => void>();
export function diagnosticError(value: unknown, seen = new WeakSet<object>()): unknown {
  const clean = (text: string) => text.replace(/(?:bearer\s+|["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,;"'&}]+|sk-[a-zA-Z0-9_-]{12,}/gi, '[credential]');
  if (!value || typeof value !== 'object') return clean(String(value));
  if (seen.has(value)) return '[Circular error reference]';
  seen.add(value);
  const error = value as Error & { cause?: unknown; errors?: unknown[] };
  return { kind: clean(error.name || 'Error'), message: clean(error.message || String(value)),
    stack: clean(error.stack || ''),
    ...('cause' in error ? { cause: diagnosticError(error.cause, seen) } : {}),
    ...(Array.isArray(error.errors) ? { errors: error.errors.map(item => diagnosticError(item, seen)) } : {}) };
}
export function recordPluginDiagnostic(plugin: Plugin, name: string, error?: unknown): void {
  try { reporters.get(plugin)?.(name, error); } catch { /* Diagnostics must not affect plugin work. */ }
}


/** Attribute only this plugin's errors, never arbitrary vault or host content. */
export function installPluginDiagnostics(plugin: Plugin): void {
  if (reporters.has(plugin)) return;
  const platform = /Win/i.test(navigator.platform) ? 'windows' : /Android/i.test(navigator.userAgent) ? 'android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'ios' : /Mac/i.test(navigator.platform) ? 'macos' : 'linux';
  const key = 'datadog.pending.' + plugin.manifest.id;
  let active = true, busy = false;
  const history: string[] = [];
  const session = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let pending: string[] = [];
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) pending = saved.filter((s: unknown) => typeof s === 'string').slice(0,64); } catch (_) {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(pending)); } catch (_) {} };
  const flush = async () => {
    if (!active || busy || pending.length === 0) return;
    busy = true;
    try {
      while (active && pending.length > 0) {
        const batch = pending.slice(0,10);
        const response = await requestUrl({
          url: 'https://browser-intake-us5-datadoghq.com/api/v2/logs?ddsource=obsidian&dd-api-key=pub389b83c36d451a11dc32f7a71251a5c9',
          method: 'POST', contentType: 'application/json', body: '[' + batch.join(',') + ']', throw: false,
        });
        if (response.status < 200 || response.status >= 300) break;
        for (const row of batch) { const index = pending.indexOf(row); if (index >= 0) pending.splice(index,1); } save();
      }
    } catch (_) {} finally { busy = false; }
  };
  const record = (name: string, error?: unknown) => {
    if (!active) return;
    if (pending.length >= 64) { if (error === undefined) return; pending.shift(); }
    const exception = error === undefined ? undefined : diagnosticError(error);
    pending.push(JSON.stringify({service: plugin.manifest.id, ddsource: 'obsidian', message: name,
      status: exception ? 'error' : 'info', version: plugin.manifest.version,
      ddtags: 'env:production,platform:' + platform, date: new Date().toISOString(),
      session_id: session,
      ...(exception ? {error: exception, breadcrumbs: history.slice()} : {}),
    }));
    save(); void flush();
  };
  reporters.set(plugin, (name, error) => {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)) return;
    if (error !== undefined) record(name, error);
    history.push(new Date().toISOString() + ' ' + name);
    if (history.length > 64) history.shift();
  });
  const ownError = (error: unknown) => error instanceof Error &&
    (error.stack || '').includes('plugin:' + plugin.manifest.id);
  const onError = (event: ErrorEvent) => { if (ownError(event.error)) recordPluginDiagnostic(plugin,'unhandled_error',event.error); };
  const onRejection = (event: PromiseRejectionEvent) => { if (ownError(event.reason)) recordPluginDiagnostic(plugin,'unhandled_rejection',event.reason); };
  window.addEventListener('error',onError);
  window.addEventListener('unhandledrejection',onRejection);
  const retry = window.setInterval(()=>{void flush();},30000);
  plugin.register(()=>{reporters.delete(plugin);active=false;window.clearInterval(retry);window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);});
  record('app_started');
}
