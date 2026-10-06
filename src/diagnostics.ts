/** Timed stages, internal error propagation, and recovery at host callback boundaries. */
type Sink = { info(event: string, detail?: unknown): void; error(event: string, detail?: unknown): void; notifyFailure?(stage: string): void };
let sink: Sink | undefined;
let enabled: () => boolean = () => false;
let span = 0;
const repetitions = new Map<string, { at: number; count: number }>();
const noop = (): void => {};
// Setting.then is a fluent builder. Only actual Promise objects are asynchronous work.
function isPromise(value: unknown): value is Promise<unknown> {
  return value != null && Object.prototype.toString.call(value) === '[object Promise]';
}
function isError(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === "[object Error]";
}
function report(stage: string, error: unknown): void {
  try {
    const failure = isError(error) ? error : new Error(String(error));
    if (!isError(error)) Object.defineProperty(failure, "cause", { value: error, configurable: true });
    if (sink) sink.error(stage + '.failed', failure);
    else console.error('[Plugin diagnostics] ' + stage + '.failed', failure);
  } catch { /* A broken logger must not change operation recovery or cleanup. */ }
}
export const diagnostics = {
  attach(target: Sink, isEnabled: () => boolean): void { sink = target; enabled = isEnabled; repetitions.clear(); },
  detach(target: Sink): void { if (sink === target) { sink = undefined; enabled = () => false; } },
  start(stage: string): () => void {
    try {
      if (!sink || !enabled()) return noop;
      const started = performance.now();
      const previous = repetitions.get(stage);
      if (previous && started - previous.at < 1000) { if (++previous.count > 4) return noop; }
      else { if (repetitions.size >= 512) repetitions.delete(repetitions.keys().next().value!); repetitions.set(stage, { at: started, count: 1 }); }
      const id = ++span, target = sink;
      target.info(stage + '.start', { span: id });
      return () => { try { target.info(stage + '.end', { span: id, elapsedMs: Math.round(performance.now() - started) }); } catch {} };
    } catch { return noop; }
  },
  run<T>(stage: string, action: () => T): T {
    const end = this.start(stage);
    try {
      const result = action();
      if (isPromise(result)) {
        return result.then(value => { end(); return value; }, error => { this.failure(stage, error); end(); throw error; }) as T;
      }
      end(); return result;
    } catch (error) { this.failure(stage, error); end(); throw error; }
  },
  /** Consume failures only where Obsidian invokes us; internal operations keep rejecting. */
  guard<T>(stage: string, action: () => T, fallback?: T): T {
    const recover = (error: unknown): T => {
      this.failure(stage, error);
      if (!(isError(error) && error.name === 'AbortError')) {
        try { sink?.notifyFailure?.(stage); } catch {}
      }
      return fallback as T;
    };
    try {
      const result = action();
      return isPromise(result) ? result.catch(recover) as T : result;
    } catch (error) { return recover(error); }
  },
  wrap<T extends (...args: any[]) => any>(stage: string, callback: T, fallback?: ReturnType<T>): T {
    return function(this: unknown, ...args: Parameters<T>) {
      return diagnostics.guard(stage, () => callback.apply(this, args), fallback);
    } as T;
  },
  request<T, Args extends unknown[]>(stage: string, action: (...args: Args) => T, ...args: Args): T {
    return this.run(stage, () => {
      const result = action(...args);
      const reportStatus = (value: unknown): void => {
        const status = (value as { status?: unknown } | null)?.status;
        if (typeof status === 'number' && status >= 400) {
          const error = new Error('HTTP request failed with status ' + status) as Error & { httpStatus: number }; error.httpStatus = status;
          if (sink) { try { sink.error(stage + '.http_failed', error); } catch {} } else report(stage + '.http_failed', error);
        }
      };
      if (isPromise(result)) return result.then(value => { reportStatus(value); return value; }) as T;
      reportStatus(result); return result;
    });
  },
  failure(stage: string, error?: unknown): void {
    if (isError(error) && error.name === 'AbortError') {
      try { sink?.info(stage + '.cancelled'); } catch {}
    } else report(stage, error ?? new Error('Operation failed'));
  },
  legacy(level: 'info' | 'warn' | 'error', stage: string): void {
    try {
      if (level === 'info') sink?.info(stage);
      else sink?.error(stage, { outcome: 'failed' });
    } catch {}
  },
};
