import { App, Modal, Notice, Plugin, Setting } from "obsidian";
import type { Command } from "obsidian";

export interface PluginDocumentation {
  name: string;
  summary: string;
  quickStart: string[];
  commands: string[];
  troubleshooting: string[];
}

interface LogEntry {
  at: string;
  level: "info" | "warn" | "error";
  event: string;
  detail?: string;
}

const SAFE_DETAIL_KEYS = new Set([
  "version", "operation", "scope", "selectedCount", "total", "changed", "skipped",
  "failed", "unchanged", "reviewEnabled", "fieldCount", "noteChars", "httpStatus",
  "errorType", "outcome", "restored", "authorizationSource", "cancelled", "line",
  "column", "settingCount", "attempt", "attempts", "queueCount", "itemCount",
  "fileCount", "imageCount", "stage", "category", "status", "durationMs", "elapsedMs",
]);

function safeString(value: string): string {
  if (value.length <= 120 && /^[A-Za-z0-9 _=.,:-]*$/.test(value) && !/(?:sk-[A-Za-z0-9]|bearer|api.?key|token|secret)/i.test(value)) {
    return value;
  }
  return "[omitted]";
}

function safeDetail(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ errorType: safeString(value.name || "Error") });
  if (!value || typeof value !== "object" || Array.isArray(value)) return "[detail omitted]";

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    if (typeof item === "string") safe[key] = safeString(item);
    else if (typeof item === "number" && Number.isFinite(item)) safe[key] = item;
    else if (typeof item === "boolean" || item === null) safe[key] = item;
  }
  return JSON.stringify(safe);
}

function safeErrorType(error: unknown): string {
  if (error instanceof Error) return safeString(error.name || "Error");
  return safeString(typeof error);
}

class DocumentationModal extends Modal {
  constructor(app: App, private readonly docs: PluginDocumentation) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.docs.name + " documentation");
    this.contentEl.createEl("p", { text: this.docs.summary });
    const addSection = (title: string, items: string[]) => {
      this.contentEl.createEl("h3", { text: title });
      const list = this.contentEl.createEl("ol");
      for (const item of items) list.createEl("li", { text: item });
    };
    addSection("Quick start", this.docs.quickStart);
    addSection("Useful commands", Array.from(new Set([...this.docs.commands, "Copy full debug log"])));
    addSection("Troubleshooting", this.docs.troubleshooting);
  }

  onClose(): void { this.contentEl.empty(); }
}

/**
 * Keeps a bounded, privacy-safe log of this plugin's commands and runtime
 * errors. It exposes a full-buffer copy action without collecting note data.
 */
export class PluginSupport {
  private readonly entries: LogEntry[] = [];
  private readonly maxEntries = 1000;
  private droppedEntries = 0;
  private started = false;

  constructor(private readonly plugin: Plugin, private readonly docs: PluginDocumentation) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.info("plugin.loaded", { version: this.plugin.manifest.version });
    this.plugin.registerDomEvent(window, "error", (event: ErrorEvent) => {
      const error = event.error;
      this.error("runtime.error", {
        errorType: error instanceof Error ? error.name : "ErrorEvent",
        line: event.lineno,
        column: event.colno,
      });
    });
    this.plugin.registerDomEvent(window, "unhandledrejection", (event: PromiseRejectionEvent) => {
      this.error("runtime.unhandled_rejection", { errorType: safeErrorType(event.reason) });
    });

    const addCommand = this.plugin.addCommand.bind(this.plugin);
    const registerCommand = (command: Command) => addCommand(this.instrumentCommand(command));
    registerCommand({
      id: "open-documentation",
      name: "Open documentation",
      callback: () => new DocumentationModal(this.plugin.app, this.docs).open(),
    });
    registerCommand({
      id: "copy-debug-log",
      name: "Copy full debug log",
      callback: () => this.copyDiagnostics(),
    });
    registerCommand({
      id: "open-plugin-settings",
      name: "Open plugin settings",
      callback: () => {
        const setting = (this.plugin.app as any).setting;
        setting?.open();
        setting?.openTabById(this.plugin.manifest.id);
      },
    });

    this.instrumentFutureCommands(addCommand);
  }

  info(event: string, detail?: unknown): void { this.record("info", event, detail); }
  warn(event: string, detail?: unknown): void { this.record("warn", event, detail); }
  error(event: string, detail?: unknown): void { this.record("error", event, detail); }

  addDiagnosticsSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Diagnostics")
      .setDesc("Copy up to the latest 1,000 events recorded by this plugin. Logs reset when the plugin reloads. Note contents, paths, credentials, and raw error messages are excluded.")
      .addButton((button) => button
        .setButtonText("Copy full log")
        .onClick(() => { void this.copyDiagnostics(); }));
  }

  private instrumentFutureCommands(addCommand: (command: Command) => Command): void {
    const originalDescriptor = Object.getOwnPropertyDescriptor(this.plugin, "addCommand");
    Object.defineProperty(this.plugin, "addCommand", {
      configurable: true,
      writable: true,
      value: (command: Command) => addCommand(this.instrumentCommand(command)),
    });
    this.plugin.register(() => {
      if (originalDescriptor) Object.defineProperty(this.plugin, "addCommand", originalDescriptor);
      else Reflect.deleteProperty(this.plugin, "addCommand");
    });
  }

  private instrumentCommand(command: Command): Command {
    const instrument = (callback: (...args: any[]) => any) =>
      (...args: any[]) => this.trackCommand(command.id, () => callback.apply(command, args));

    return {
      ...command,
      callback: command.callback ? instrument(command.callback) : undefined,
      editorCallback: command.editorCallback ? instrument(command.editorCallback) : undefined,
      checkCallback: command.checkCallback
        ? (checking) => checking ? command.checkCallback!(checking) : this.trackCommand(command.id, () => command.checkCallback!(checking))
        : undefined,
      editorCheckCallback: command.editorCheckCallback
        ? (checking, editor, context) => checking
          ? command.editorCheckCallback!(checking, editor, context)
          : this.trackCommand(command.id, () => command.editorCheckCallback!(checking, editor, context))
        : undefined,
    };
  }

  private trackCommand<T>(commandId: string, action: () => T): T {
    const startedAt = Date.now();
    this.info("command.started", { operation: commandId });
    try {
      const result = action();
      if (result && typeof (result as any).then === "function") {
        return Promise.resolve(result).then(
          (value) => {
            this.info("command.completed", { operation: commandId, durationMs: Date.now() - startedAt });
            return value;
          },
          (error) => {
            this.error("command.failed", { operation: commandId, errorType: safeErrorType(error), durationMs: Date.now() - startedAt });
            throw error;
          },
        ) as unknown as T;
      }
      this.info("command.completed", { operation: commandId, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.error("command.failed", { operation: commandId, errorType: safeErrorType(error), durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  private record(level: LogEntry["level"], event: string, detail?: unknown): void {
    const safeEvent = /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(event) ? event : "invalid_event";
    const entry: LogEntry = { at: new Date().toISOString(), level, event: safeEvent };
    if (detail !== undefined) entry.detail = safeDetail(detail);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      const removed = this.entries.length - this.maxEntries;
      this.entries.splice(0, removed);
      this.droppedEntries += removed;
    }
    const method = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    method.call(console, "[" + this.docs.name + "] " + entry.event, entry.detail ?? "");
  }

  async copyDiagnostics(): Promise<void> {
    this.info("diagnostics.copy_requested", { total: this.entries.length + 1 });
    const captured = new Date().toISOString();
    const snapshot = this.entries.slice();
    const header = [
      "Plugin debug log",
      "Log scope: this plugin, since its most recent load",
      "Plugin: " + this.docs.name,
      "Plugin ID: " + this.plugin.manifest.id,
      "Version: " + this.plugin.manifest.version,
      "Captured: " + captured,
      "User agent: " + navigator.userAgent,
      "Events included: " + snapshot.length,
      "Older events omitted: " + this.droppedEntries,
      "",
    ];
    const text = header.concat(snapshot.map((entry) =>
      entry.at + " [" + entry.level.toUpperCase() + "] " + entry.event + (entry.detail ? " — " + entry.detail : ""),
    )).join("\n");

    try {
      await navigator.clipboard.writeText(text);
      this.info("diagnostics.copy_succeeded", { total: snapshot.length });
      const omitted = this.droppedEntries ? "; " + this.droppedEntries + " older events omitted" : "";
      new Notice(this.docs.name + ": copied " + snapshot.length + " log events" + omitted + ".");
    } catch (error) {
      this.error("diagnostics.copy_failed", { errorType: safeErrorType(error) });
      new Notice(this.docs.name + ": could not copy the debug log.");
    }
  }
}
