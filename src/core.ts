export interface TemplateContext {
  time: string;
  source: string;
  text: string;
  id: string;
}

export function formatTimestamp(date: Date, format: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const replacements: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => replacements[token]);
}

export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{\s*(time|source|text|id)\s*\}\}/gi, (_, key: string) => {
    const normalized = key.toLowerCase() as keyof TemplateContext;
    return context[normalized];
  });
}

export function normalizeVaultPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function joinVaultPath(folder: string, file: string): string {
  const left = normalizeVaultPath(folder);
  const right = normalizeVaultPath(file);
  return [left, right].filter(Boolean).join("/");
}

export function dailyNotePath(folder: string, date: Date, format: string): string {
  return joinVaultPath(folder, `${formatTimestamp(date, format)}.md`);
}

export function appendText(existing: string, entry: string): string {
  if (!existing) return entry;
  const separator = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}${entry}`;
}

export function diagnosticSummary(destination: string, error: unknown, queueId: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Kairo could not deliver capture ${queueId}. Destination: ${destination}. Reason: ${message}`;
}
