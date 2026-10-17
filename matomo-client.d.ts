export interface MatomoConfig { product: string; siteId: number; enabled?: boolean; platform?: string; screens?: string[]; features?: string[]; }
export interface MatomoStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; }
export class MatomoClient { constructor(config: MatomoConfig, dependencies?: {storage?: MatomoStorage;send?: (body: string) => Promise<unknown>}); readonly configured: boolean; enabled: boolean; initialize(): Promise<void>; screen(name: string): Promise<void>; event(category: string, action: string, name: string, value?: number): Promise<void>; }
export function localStorageAdapter(storage: Storage): MatomoStorage;
