import { Plugin, requestUrl } from 'obsidian';
import { MatomoClient, localStorageAdapter } from './matomo-client';
const instances = new WeakMap<Plugin, MatomoClient>();
export function matomoFor(plugin: Plugin): MatomoClient | undefined { return instances.get(plugin); }
export function initializeMatomo(plugin: Plugin): void {
  try {
    if (instances.has(plugin)) return;
    const client = new MatomoClient({ product: 'obsidian_kairo_quick_capture', siteId: 123, platform: 'obsidian', features: ["capture_delivered"] }, {
      storage: localStorageAdapter(window.localStorage),
      send: async body => { await requestUrl({url:'https://atcdn.cyou/matomo.php',method:'POST',contentType:'application/x-www-form-urlencoded',body,throw:false}); },
    });
    instances.set(plugin,client);
    plugin.register(() => { client.enabled=false; instances.delete(plugin); });
    void client.initialize().then(() => client.screen('home')).catch(() => {});
  } catch (_) {}
}
