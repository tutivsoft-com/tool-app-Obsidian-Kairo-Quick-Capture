import { diagnostics } from "./diagnostics";
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
  "column", "span", "settingCount", "attempt", "attempts", "queueCount", "itemCount",
  "fileCount", "imageCount", "stage", "category", "status", "durationMs", "elapsedMs",
]);

function safeString(value: string): string {
  if (value.length <= 120 && /^[A-Za-z0-9 _=.,:-]*$/.test(value) && !/(?:sk-[A-Za-z0-9]|bearer|api.?key|token|secret)/i.test(value)) {
    return value;
  }
  return "[omitted]";
}

function isError(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === "[object Error]";
}

function safeDetail(value: unknown): string {
  if (isError(value)) { const status = (value as Error & { httpStatus?: number }).httpStatus; return JSON.stringify({ errorType: safeString(value.name || "Error"), ...(typeof status === "number" && Number.isFinite(status) ? { httpStatus: status } : {}) }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "[detail omitted]";

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    if (typeof item === "string") {
      if (key === "version" && /^\d+\.\d+\.\d+$/.test(item)) safe[key] = item;
      else if (key === "errorType") safe[key] = ["Error", "TypeError", "RangeError", "SyntaxError", "AbortError"].includes(item) ? item : "Error";
      else if (key === "outcome" && ["failed", "cancelled", "completed"].includes(item)) safe[key] = item;
    }
    else if (typeof item === "number" && Number.isFinite(item)) safe[key] = item;
    else if (typeof item === "boolean" || item === null) safe[key] = item;
  }
  return JSON.stringify(safe);
}

function safeErrorType(error: unknown): string {
  if (isError(error)) return safeString(error.name || "Error");
  return safeString(typeof error);
}

class DocumentationModal extends Modal {
  constructor(app: App, private readonly docs: PluginDocumentation, private readonly plugin?: Plugin, private readonly welcome = false) { super(app); }
  onOpen(): void {
return diagnostics.guard("plugin-support.onOpen_1", () => {
    this.titleEl.setText(this.welcome ? "Welcome to " + this.docs.name : this.docs.name + " Help");
    this.contentEl.createEl("p", { text: this.docs.summary });
    const steps = this.contentEl.createEl("ol");
    this.docs.quickStart.forEach(text => steps.createEl("li", { text }));
    const settings = () => { const target = (this.app as any).setting; target?.open(); target?.openTabById(this.plugin?.manifest.id); this.close(); };
    new Setting(this.contentEl).addButton(button => button.setButtonText("Open account").setCta().onClick(diagnostics.wrap("plugin-support.control_2", settings)))
      .addButton(button => button.setButtonText("Open Quick Capture").onClick(() => {
return diagnostics.guard("plugin-support.control_3", () => {
        const commands = (this.app as any).commands;
        const id = this.plugin?.manifest.id + ":" + "open-capture";
        const available = commands?.executeCommandById?.(id);
        if (available === false || !commands?.executeCommandById) new Notice("Open the command palette and choose " + this.docs.name + ". Check the selected note or attachment first.");
        this.close();

});
}));
    const section = (title: string, items: string[]) => { const details = this.contentEl.createEl("details"); details.createEl("summary", { text: title }); const list = details.createEl("ul"); items.forEach(text => list.createEl("li", { text })); return details; };
    const problems = section("Common problems", ["Email not received? Check spam, confirm the address in Account, then use Connect again after verification. Use the account page for recovery; do not create another account to recover purchases.", ...this.docs.troubleshooting]);
    new Setting(problems).addButton(button => button.setButtonText("Open account").onClick(diagnostics.wrap("plugin-support.control_4", settings)));
    problems.createEl("a", { text: "Forgot password?", href: "https://app.tutivsoft.com/password-reset", attr: { target: "_blank", rel: "noopener noreferrer" } });
    section("Account and purchases", ["Your remaining free allowance and purchases belong to your account. Your credit balance stays with your account after reinstalling. Current prices are shown in Account. Refresh balance after a delayed payment instead of purchasing again."]);
    section("Advanced settings — optional", ["Simple shows everyday controls. Open Settings and choose Advanced for more customization and troubleshooting. Switching views keeps saved preferences."]);
    section("Useful commands", Array.from(new Set([...this.docs.commands, "Open documentation", "Copy diagnostic log"])));
    section("Removing the app", ["Removing this plugin does not undo edits or delete your account. Export anything you want to keep before removing it in Obsidian Settings → Community plugins. Reconnect the same account after reinstalling to restore its remaining allowance and purchases. Open the capture queue and deliver or copy pending captures before removing the plugin."]);

});
}
  onClose(): void {
return diagnostics.guard("plugin-support.onClose_5", () => { this.contentEl.empty();
});
}
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
  private lastFailureNotice = 0;
  private readonly knownCommands = new Set(["toggle-debug-logging","open-documentation","copy-debug-log","open-plugin-settings","open-capture","flush-queue","show-queue"]);
  private readonly repetitions = new Map<string, { at: number; count: number }>();

  constructor(private readonly plugin: Plugin, private readonly docs: PluginDocumentation) {
    diagnostics.attach(this, () => this.debugEnabled());
    this.plugin.register(() => diagnostics.guard("plugin-support.event_6", () => (diagnostics.detach(this))));
  }

  private debugEnabled(): boolean {
    return (this.plugin as Plugin & { settings?: { debugLogging?: boolean } }).settings?.debugLogging === true;
  }

  addDebugSetting(containerEl: HTMLElement): void {
    const renderEnd = diagnostics.start("settings.render.debug_logging");
    try {
      new Setting(containerEl).setName("Debug logging").setDesc("Record detailed activity logs for troubleshooting. Off by default.")
        .addToggle(toggle => toggle.setValue(this.debugEnabled()).onChange(value => diagnostics.guard("plugin-support.control_7", () => (this.setDebugLogging(value)))));
    } finally { renderEnd(); }
  }

  async setDebugLogging(value: boolean): Promise<void> {
    const host = this.plugin as Plugin & { settings: { debugLogging?: boolean }; persist?: () => Promise<void>; saveSettings?: () => Promise<void> };
    const previous = host.settings.debugLogging;
    host.settings.debugLogging = value;
    const end = diagnostics.start("settings.debug_logging.callback");
    try {
      if (host.persist) await host.persist();
      else if (host.saveSettings) await host.saveSettings();
      else await host.saveData(host.settings);
    } catch (error) {
      diagnostics.failure("settings.debug_logging.callback", error);
      host.settings.debugLogging = previous;
      throw error;
    } finally { end(); }
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.info("plugin.loaded", { version: this.plugin.manifest.version });
    this.plugin.registerDomEvent(window, "error", (event: ErrorEvent) => {
return diagnostics.guard("plugin-support.event_8", () => {
      const source = event.filename || event.error?.stack || "";
      if (source && !source.includes("plugin:" + this.plugin.manifest.id)) return;
      this.error("runtime.error", event.error || new Error(event.message || "Uncaught runtime error"));

});
});
    this.plugin.registerDomEvent(window, "unhandledrejection", (event: PromiseRejectionEvent) => {
return diagnostics.guard("plugin-support.event_9", () => {
      const source = event.reason?.stack || "";
      if (source && !source.includes("plugin:" + this.plugin.manifest.id)) return;
      diagnostics.failure("runtime.unhandled_rejection", event.reason);

});
});

    const addCommand = this.plugin.addCommand.bind(this.plugin);
    const registerCommand = (command: Command) => addCommand(this.instrumentCommand(command));
    registerCommand({
      id: "open-documentation",
      name: "Open documentation",
      callback: () => new DocumentationModal(this.plugin.app, this.docs, this.plugin).open(),
    });
    registerCommand({
      id: "copy-debug-log",
      name: "Copy diagnostic log",
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



    registerCommand({
      id: "toggle-debug-logging",
      name: "Toggle debug logging",
      callback: async () => {
        try {
          await this.setDebugLogging(!this.debugEnabled());
          new Notice(this.docs.name + ": debug logging " + (this.debugEnabled() ? "enabled." : "disabled."));
        } catch (caughtError10) {
diagnostics.failure("plugin-support.caught_11", caughtError10);
          new Notice(this.docs.name + ": could not save the logging setting. Try again.");
        }
      },
    });
    this.instrumentFutureCommands(addCommand);
  }

  /** Called after settings and first-action commands have loaded, including on a ready workspace. */
  showWelcome(): void {
    this.plugin.app.workspace.onLayoutReady(() => {
return diagnostics.guard("plugin-support.event_12", () => {
      const host = this.plugin as Plugin & { settings: Record<string, any>; persist?: () => Promise<void>; saveSettings?: () => Promise<void> };
      const state = host.settings?.billing || host.settings;
      if (!this.automaticWindowsEnabled() || !state || state.billingAccountLinked || state.flowWelcomeSeen || state.accountWelcomeSeen || state.billingOnboardingSeen || state.onboardingShown || host.settings.onboardingShown) return;
      const persist = host.persist ? () => host.persist!() : host.saveSettings ? () => host.saveSettings!() : () => this.plugin.saveData(host.settings);
      state.flowWelcomeSeen = true;
      void diagnostics.guard("plugin-support.background_13", () => (persist().then(() => new DocumentationModal(this.plugin.app, this.docs, this.plugin, true).open()).catch((rejectedError1) => {
diagnostics.failure("plugin-support.rejected_2", rejectedError1); state.flowWelcomeSeen = false; new Notice("Could not save setup progress. Your existing data is unchanged; reopen Help to continue."); })));

});
});
  }

  notifyFailure(_stage: string): void {
    const now = Date.now();
    if (now - this.lastFailureNotice < 5000) return;
    this.lastFailureNotice = now;
    try { new Notice(this.docs.name + ": this action could not be completed. Try again or copy the diagnostic log for support."); } catch (caughtError14) {
}
  }

  info(event: string, detail?: unknown): void { this.record("info", event, detail); }
  warn(event: string, detail?: unknown): void { this.record("warn", event, detail); }
  error(event: string, detail?: unknown): void { this.record("error", event, detail); }

  automaticWindowsEnabled(): boolean {
    return (this.plugin as Plugin & { settings?: Record<string, any> }).settings?.autoShowOperationWindows === true;
  }

  addHelpSetting(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Show automatic windows")
      .setDesc("Open queue, progress, result, and welcome windows automatically. Off by default; status messages remain visible.")
      .addToggle(toggle => toggle.setValue(this.automaticWindowsEnabled()).onChange(async enabled => {
        const host = this.plugin as Plugin & { settings: Record<string, any>; persist?: () => Promise<void>; saveSettings?: () => Promise<void> };
        const previous = host.settings.autoShowOperationWindows;
        host.settings.autoShowOperationWindows = enabled;
        try {
          if (host.persist) await host.persist();
          else if (host.saveSettings) await host.saveSettings();
          else await host.saveData(host.settings);
        } catch (error) {
          host.settings.autoShowOperationWindows = previous;
          toggle.setValue(this.automaticWindowsEnabled());
          new Notice("Could not save the automatic windows preference. Try again.");
        }
      }));
    new Setting(containerEl).setName("Help").setDesc("Get started, recover your account, or remove the plugin.")
      .addButton(button => button.setButtonText("Open Help").onClick(() => diagnostics.guard("plugin-support.control_16", () => (new DocumentationModal(this.plugin.app, this.docs, this.plugin).open()))));
  }

  addDiagnosticsSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Diagnostics")
      .setDesc("Copy up to the latest 1,000 events recorded by this plugin. Logs reset when the plugin reloads. Note contents, paths, credentials, and raw error messages are excluded.")
      .addButton((button) => button
        .setButtonText("Copy full log")
        .onClick(() => {
return diagnostics.guard("plugin-support.control_17", () => { void diagnostics.guard("plugin-support.background_18", () => (this.copyDiagnostics()));
});
}));
  }

  private instrumentFutureCommands(addCommand: (command: Command) => Command): void {
    const originalDescriptor = Object.getOwnPropertyDescriptor(this.plugin, "addCommand");
    Object.defineProperty(this.plugin, "addCommand", {
      configurable: true,
      writable: true,
      value: (command: Command) => addCommand(this.instrumentCommand(command)),
    });
    this.plugin.register(() => {
return diagnostics.guard("plugin-support.event_19", () => {
      if (originalDescriptor) Object.defineProperty(this.plugin, "addCommand", originalDescriptor);
      else Reflect.deleteProperty(this.plugin, "addCommand");

});
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
        ? (checking) => this.trackCommand(command.id, () => command.checkCallback!(checking))
        : undefined,
      editorCheckCallback: command.editorCheckCallback
        ? (checking, editor, context) => this.trackCommand(command.id, () => command.editorCheckCallback!(checking, editor, context))
        : undefined,
    };
  }

  private trackCommand<T>(commandId: string, action: () => T): T {
    const stage = "command." + (this.knownCommands.has(commandId) ? commandId : "custom");
    return diagnostics.guard(stage, () => diagnostics.run(stage, action), false as T);
  }

  private record(level: LogEntry["level"], event: string, detail?: unknown): void {
    const admittedEnd = event.endsWith(".end") && typeof (detail as { span?: unknown } | undefined)?.span === "number";
    if (level === "info" && !this.debugEnabled() && !admittedEnd) return;
    const now = Date.now();
    const repeatKey = level + ":" + event;
    const previous = this.repetitions.get(repeatKey);
    if (!event.endsWith(".start") && !event.endsWith(".end") && previous && now - previous.at < 1000) {
      previous.count++;
      if (previous.count > 4) return;
    } else {
      if (this.repetitions.size >= 512) this.repetitions.delete(this.repetitions.keys().next().value!);
      this.repetitions.set(repeatKey, { at: now, count: 1 });
    }
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
    try {
      const prefix = "[" + this.docs.name + " v" + this.plugin.manifest.version + "] " + entry.event;
      if (isError(detail)) method.call(console, prefix, entry.detail ?? "", detail);
      else method.call(console, prefix, entry.detail ?? "");
    } catch (caughtError20) {
 /* Console failures must not break plugin actions. */ }
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
diagnostics.failure("plugin-support.caught_22", error);
      this.error("diagnostics.copy_failed", error);
      new Notice(this.docs.name + ": could not copy the debug log.");
    }
  }
}
