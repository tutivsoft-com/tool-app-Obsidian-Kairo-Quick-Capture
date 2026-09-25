import {
  App,
  Editor,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import {
  appendText,
  dailyNotePath,
  diagnosticSummary,
  joinVaultPath,
  normalizeVaultPath,
  renderTemplate,
  formatTimestamp,
} from "./src/core";
import {
  consumeCaptureUse,
  currentDayKey,
  generateSecureDeviceId,
  normalizeBillingSettings,
  openBuyCheckout,
  pollAuthenticatedCheckout,
  retryPendingSpendEvents,
  syncPurchasedUses,
} from "./src/billing";
import { PluginSupport } from "./src/plugin-support";
import { addBillingAccountSettings } from "./src/constance-account";

const VERSION = "3.4.17";
const DEFAULT_TEMPLATE = "- {{time}} — {{text}}\n";
const DEFAULT_SETTINGS: KairoSettings = {
  shortcut: "Ctrl+Shift+Space",
  vaultFolder: "",
  destinationMode: "inbox",
  inboxPath: "Inbox.md",
  dailyFolder: "Daily",
  dailyFormat: "YYYY-MM-DD",
  template: DEFAULT_TEMPLATE,
  timestampFormat: "YYYY-MM-DD HH:mm",
  createMissing: false,
  closeAfterSaving: true,
  launchAtLogin: false,
  constanceDeviceId: "",
  billingEmail: "",
  billingAccessToken: "",
  billingAccountLinked: false,
  freeUsesRemaining: 3,
  freeUsesDay: currentDayKey(),
  purchasedUses: 0,
  pendingSpendEvents: [],
};

export interface KairoSettings {
  shortcut: string;
  vaultFolder: string;
  destinationMode: "inbox" | "daily";
  inboxPath: string;
  dailyFolder: string;
  dailyFormat: string;
  template: string;
  timestampFormat: string;
  createMissing: boolean;
  closeAfterSaving: boolean;
  launchAtLogin: boolean;
  constanceDeviceId: string;
  billingEmail: string;
  billingAccessToken: string;
  billingAccountLinked: boolean;
  freeUsesRemaining: number;
  freeUsesDay: string;
  purchasedUses: number;
  pendingSpendEvents: Array<{ eventId: string; amount: number }>;
}

interface QueuedCapture {
  id: string;
  createdAt: number;
  destination: string;
  entry: string;
  attempts: number;
  lastError?: string;
}

interface KairoData {
  settings: KairoSettings;
  queue: QueuedCapture[];
}

class DestinationChangedError extends Error {
  constructor() {
    super("The destination changed while Kairo was preparing the append. Nothing was overwritten.");
    this.name = "DestinationChangedError";
  }
}

type ElectronRequire = (moduleName: string) => {
  globalShortcut?: { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void };
  app?: { isReady?(): boolean; setLoginItemSettings?(settings: { openAtLogin: boolean }): void };
};

export default class KairoQuickCapturePlugin extends Plugin {
  support!: PluginSupport;
  settings: KairoSettings = { ...DEFAULT_SETTINGS };
  queue: QueuedCapture[] = [];
  private globalShortcut?: string;
  private checkoutPollTimer?: number;
  private persistChain: Promise<void> = Promise.resolve();
  private deliveryChain: Promise<void> = Promise.resolve();
  private queueFlushPromise?: Promise<void>;

  async onload(): Promise<void> {
    this.support = new PluginSupport(this, { name: "Kairo Quick Capture", summary: "Capture ideas quickly to an inbox or daily note, including while the target is unavailable.", quickStart: ["Sign in to billing in Settings.", "Run Quick capture.", "Type the capture and submit; Kairo chooses the configured default destination."], commands: ["Quick capture", "Show capture queue", "Flush queue"], troubleshooting: ["Use Copy debug log before reporting a problem.", "Check the configured destination when queued captures do not flush."] });
    this.support.start();
    const data = (await this.loadData()) as Partial<KairoData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.queue = Array.isArray(data?.queue) ? data.queue : [];
    if (!this.settings.constanceDeviceId) this.settings.constanceDeviceId = generateSecureDeviceId();
    normalizeBillingSettings(this.settings);
    await this.persist();

    this.addCommand({
      id: "open-capture",
      name: "Open quick capture",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "K" }],
      callback: () => this.openCapture(),
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => this.addEditorMenuItems(menu, editor, info.file)));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addFileMenuItems(menu, file)));
    this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => this.addFilesMenuItems(menu, files)));
    this.addCommand({
      id: "flush-queue",
      name: "Flush queued captures",
      callback: () => this.flushQueue(true),
    });
    this.addCommand({
      id: "show-queue",
      name: "Show queued captures",
      callback: () => new QueueModal(this.app, this).open(),
    });
    this.addSettingTab(new KairoSettingTab(this.app, this));

    this.registerInterval(window.setInterval(() => void this.flushQueue(false), 60_000));
    this.app.workspace.onLayoutReady(() => {
      this.registerGlobalShortcut();
      void this.flushQueue(false);
      void syncPurchasedUses(this).then(() => retryPendingSpendEvents(this));
    });
  }

  onunload(): void {
    this.unregisterGlobalShortcut();
    if (this.checkoutPollTimer !== undefined) window.clearInterval(this.checkoutPollTimer);
  }

  async persist(): Promise<void> {
    const snapshot: KairoData = {
      settings: { ...this.settings },
      queue: this.queue.map((item) => ({ ...item })),
    };
    const write = this.persistChain.catch(() => undefined).then(() => this.saveData(snapshot));
    this.persistChain = write;
    await write;
  }

  openCapture(initialText = ""): void {
    new CaptureModal(this.app, this, initialText).open();
  }

  private addEditorMenuItems(menu: Menu, editor: Editor, file: TFile | null): void {
    const selection = editor.getSelection().trim();
    if (selection) menu.addItem((item) => item.setTitle("Kairo: Quick capture selected text").setIcon("capture").onClick(() => this.openCapture(selection)));
    if (file instanceof TFile && file.extension.toLowerCase() === "md") this.addNoteLinkMenuItem(menu, file);
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (file instanceof TFile && file.extension.toLowerCase() === "md") this.addNoteLinkMenuItem(menu, file);
  }

  private addFilesMenuItems(menu: Menu, selected: TAbstractFile[]): void {
    const paths = new Set<string>();
    for (const entry of selected) {
      if (entry instanceof TFile && entry.extension.toLowerCase() === "md") paths.add(entry.path);
      else if (entry instanceof TFolder) for (const file of this.app.vault.getMarkdownFiles()) if (file.path.startsWith(`${entry.path}/`)) paths.add(file.path);
    }
    const links = [...paths].map((path) => this.app.vault.getAbstractFileByPath(path)).filter((file): file is TFile => file instanceof TFile).map((file) => `[[${file.basename}]]`);
    if (links.length > 1) menu.addItem((item) => item.setTitle(`Kairo: Capture links to ${links.length} selected notes`).setIcon("links-coming-in").onClick(() => this.openCapture(links.join("\n"))));
  }

  private addNoteLinkMenuItem(menu: Menu, file: TFile): void {
    menu.addItem((item) => item.setTitle("Kairo: Quick capture link to this note").setIcon("link").onClick(() => this.openCapture(`[[${file.basename}]]`)));
  }

  destinationFor(date = new Date()): string {
    const relative = this.settings.destinationMode === "daily"
      ? dailyNotePath(this.settings.dailyFolder, date, this.settings.dailyFormat)
      : normalizeVaultPath(this.settings.inboxPath);
    return joinVaultPath(this.settings.vaultFolder, relative);
  }

  async capture(text: string): Promise<{ state: "saved" | "queued" | "failed"; id: string; diagnostic?: string }> {
    const trimmed = text.trimEnd();
    if (!trimmed.trim()) throw new Error("Capture is empty.");
    const id = this.makeId();
    if (!(await consumeCaptureUse(this, `evt_${id}`))) throw new Error("No capture uses remain. Buy a use pack in Kairo settings.");
    const now = new Date();
    const destination = this.destinationFor(now);
    const entry = renderTemplate(this.settings.template, {
      time: formatTimestamp(now, this.settings.timestampFormat),
      source: "Obsidian",
      text: trimmed,
      id,
    });
    try {
      await this.appendSafely(destination, entry, id);
      return { state: "saved", id };
    } catch (error) {
      const queued: QueuedCapture = { id, createdAt: now.getTime(), destination, entry, attempts: 1, lastError: diagnosticSummary(destination, error, id) };
      this.queue.push(queued);
      try {
        await this.persist();
        return { state: "queued", id, diagnostic: queued.lastError };
      } catch (persistError) {
        // A failed persistence attempt must not leave an item eligible for a
        // later in-memory flush after the user has been told to retry.
        this.queue = this.queue.filter((item) => item.id !== id);
        queued.lastError = diagnosticSummary(destination, persistError, id);
        return { state: "failed", id, diagnostic: queued.lastError };
      }
    }
  }

  async flushQueue(showNotice: boolean): Promise<void> {
    if (this.queueFlushPromise) return this.queueFlushPromise;
    const run = this.flushQueueInternal(showNotice);
    const completion = run.finally(() => {
      if (this.queueFlushPromise === completion) this.queueFlushPromise = undefined;
    });
    this.queueFlushPromise = completion;
    return completion;
  }

  private async flushQueueInternal(showNotice: boolean): Promise<void> {
    if (!this.queue.length) {
      if (showNotice) new Notice("Kairo queue is empty.");
      return;
    }
    const pending = [...this.queue].sort((a, b) => a.createdAt - b.createdAt);
    const pendingIds = new Set(pending.map((item) => item.id));
    const remaining: QueuedCapture[] = [];
    let delivered = 0;
    for (const item of pending) {
      try {
        await this.appendSafely(item.destination, item.entry, item.id);
        delivered++;
      } catch (error) {
        remaining.push({ ...item, attempts: item.attempts + 1, lastError: diagnosticSummary(item.destination, error, item.id) });
      }
    }
    // A capture can be queued while delivery is awaiting a vault read/write.
    // Keep those newer entries instead of replacing them with this flush's
    // earlier snapshot.
    const addedDuringFlush = this.queue.filter((item) => !pendingIds.has(item.id));
    this.queue = [...remaining, ...addedDuringFlush].sort((a, b) => a.createdAt - b.createdAt);
    await this.persist();
    if (showNotice) new Notice(remaining.length ? `Delivered ${delivered}; ${remaining.length} still queued.` : `Delivered ${delivered} queued capture${delivered === 1 ? "" : "s"}.`);
  }

  async validateDestination(): Promise<{ ok: boolean; path: string; reason?: string }> {
    const path = this.destinationFor();
    if (!path) return { ok: false, path, reason: "Choose an inbox file or daily-note folder first." };
    const folder = this.settings.vaultFolder ? this.app.vault.getAbstractFileByPath(normalizeVaultPath(this.settings.vaultFolder)) : null;
    if (this.settings.vaultFolder && !(folder instanceof TFolder)) return { ok: false, path, reason: "Vault folder does not exist in the current vault." };
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && !(file instanceof TFile)) return { ok: false, path, reason: "The destination path is a folder, not a Markdown file." };
    if (!file && !this.settings.createMissing) return { ok: false, path, reason: "Destination is missing. Enable 'Create missing destinations' to allow creation." };
    return { ok: true, path };
  }

  async appendSafely(path: string, entry: string, marker: string): Promise<void> {
    const write = this.deliveryChain.catch(() => undefined).then(() => this.appendSafelyUnlocked(path, entry, marker));
    this.deliveryChain = write;
    await write;
  }

  private async appendSafelyUnlocked(path: string, entry: string, marker: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized || normalized.includes("../") || normalized === "..") throw new Error("Destination must stay inside the current vault.");
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing && !(existing instanceof TFile)) throw new Error("Destination path is a folder.");
    if (!existing) {
      if (!this.settings.createMissing) throw new Error("Destination file does not exist and creation is disabled.");
      await this.ensureParentFolders(normalized);
      const markedEntry = `${entry}${entry.endsWith("\n") ? "" : "\n"}<!-- kairo:${marker} -->\n`;
      await this.app.vault.create(normalized, markedEntry);
      return;
    }
    const file = existing as TFile;
    const before = file.stat.mtime;
    const contents = await this.app.vault.read(file);
    if (contents.includes(`<!-- kairo:${marker} -->`)) return;
    const current = file.stat.mtime;
    if (current !== before) throw new DestinationChangedError();
    const markedEntry = `${entry}${entry.endsWith("\n") ? "" : "\n"}<!-- kairo:${marker} -->\n`;
    await this.app.vault.modify(file, appendText(contents, markedEntry));
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new Error(`Cannot create destination folder: ${current} is a file.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }

  copyDiagnostic(summary: string): void {
    const write = navigator.clipboard?.writeText(summary);
    if (write) void write.then(() => new Notice("Diagnostic copied. Captured text was not included."));
    else new Notice("Clipboard access is unavailable. The diagnostic is visible in the queue.");
  }

  private makeId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `kairo-${Date.now().toString(36)}-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  private registerGlobalShortcut(): void {
    this.unregisterGlobalShortcut();
    const electron = this.electron();
    if (!electron?.globalShortcut) return;
    try {
      if (electron.globalShortcut.register(this.settings.shortcut, () => this.openCapture())) this.globalShortcut = this.settings.shortcut;
    } catch {
      // Obsidian's command hotkey remains available when Electron rejects the accelerator.
    }
  }

  private unregisterGlobalShortcut(): void {
    if (!this.globalShortcut) return;
    try { this.electron()?.globalShortcut?.unregister(this.globalShortcut); } catch { /* best effort */ }
    this.globalShortcut = undefined;
  }

  applyLaunchAtLogin(): void {
    try { this.electron()?.app?.setLoginItemSettings?.({ openAtLogin: this.settings.launchAtLogin }); } catch { /* platform optional */ }
  }

  refreshShortcut(): void {
    this.registerGlobalShortcut();
  }

  pollAfterCheckout(checkoutId?: string): void {
    if (this.checkoutPollTimer !== undefined) window.clearInterval(this.checkoutPollTimer);
    let attempts = 0;
    this.checkoutPollTimer = window.setInterval(() => {
      attempts += 1;
      void (async () => {
        const settled = checkoutId ? await pollAuthenticatedCheckout(this, checkoutId).catch(() => false) : false;
        if (settled) await syncPurchasedUses(this);
        else if (!checkoutId) await syncPurchasedUses(this);
        if ((settled || attempts >= 6) && this.checkoutPollTimer !== undefined) {
          window.clearInterval(this.checkoutPollTimer);
          this.checkoutPollTimer = undefined;
        }
      })();
    }, 15_000);
  }

  private electron(): ReturnType<ElectronRequire> | undefined {
    const requireFn = (window as Window & { require?: ElectronRequire }).require;
    if (!requireFn) return undefined;
    try { return requireFn("electron"); } catch { return undefined; }
  }
}

class CaptureModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private status!: HTMLElement;
  private diagnostic?: string;

  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin, private readonly initialText = "") { super(app); }

  onOpen(): void {
    this.modalEl.addClass("kairo-capture-modal");
    this.titleEl.setText("Quick capture");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Capture locally; Kairo will deliver it to your configured destination." });
    this.textarea = this.contentEl.createEl("textarea", { attr: { ariaLabel: "Capture text", rows: "7", placeholder: "What do you want to remember?" } });
    this.textarea.value = this.initialText;
    this.status = this.contentEl.createDiv({ cls: "kairo-status", attr: { role: "status", "aria-live": "polite" } });
    this.status.setText("Ready");
    const actions = this.contentEl.createDiv({ cls: "kairo-actions" });
    const save = actions.createEl("button", { text: "Save" });
    const saveClose = actions.createEl("button", { text: "Save and close", cls: "mod-cta" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    save.addEventListener("click", () => void this.submit(false));
    saveClose.addEventListener("click", () => void this.submit(true));
    cancel.addEventListener("click", () => this.close());
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void this.submit(this.plugin.settings.closeAfterSaving); }
    });
    window.setTimeout(() => this.textarea.focus(), 20);
  }

  private async submit(closeAfter: boolean): Promise<void> {
    if (!this.textarea.value.trim()) { this.status.setText("Enter some text first."); return; }
    this.status.setText("Saving…");
    try {
      const result = await this.plugin.capture(this.textarea.value);
      if (result.state === "saved") {
        this.status.setText("Saved");
        new Notice("Capture saved.");
        if (closeAfter || this.plugin.settings.closeAfterSaving) this.close();
      } else if (result.state === "queued") {
        this.diagnostic = result.diagnostic;
        this.status.setText("Queued — destination unavailable. Your text is safe locally.");
        this.addDiagnosticAction();
        if (closeAfter) this.close();
      } else {
        this.diagnostic = result.diagnostic;
        this.status.setText("Failed — the capture could not be persisted. Keep this window open and retry.");
        this.addDiagnosticAction();
      }
    } catch (error) {
      this.status.setText(error instanceof Error ? error.message : "Could not save capture.");
    }
  }

  private addDiagnosticAction(): void {
    if (!this.diagnostic) return;
    const copy = this.contentEl.createEl("button", { text: "Copy diagnostic" });
    copy.addEventListener("click", () => this.plugin.copyDiagnostic(this.diagnostic ?? ""));
  }

  onClose(): void { this.contentEl.empty(); }
}

class QueueModal extends Modal {
  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Queued captures");
    this.contentEl.empty();
    if (!this.plugin.queue.length) { this.contentEl.createEl("p", { text: "Nothing is waiting for delivery." }); return; }
    this.contentEl.createEl("p", { text: `${this.plugin.queue.length} capture${this.plugin.queue.length === 1 ? "" : "s"} waiting. Captured text stays in this vault's plugin data until delivery.` });
    const list = this.contentEl.createEl("ul", { cls: "kairo-queue-list" });
    for (const item of [...this.plugin.queue].sort((a, b) => a.createdAt - b.createdAt)) {
      const row = list.createEl("li");
      row.createEl("strong", { text: new Date(item.createdAt).toLocaleString() });
      row.createEl("span", { text: ` · ${item.destination} · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}` });
      if (item.lastError) {
        row.createEl("p", { text: item.lastError, cls: "kairo-queue-error" });
        const copy = row.createEl("button", { text: "Copy diagnostic" });
        copy.addEventListener("click", () => this.plugin.copyDiagnostic(item.lastError ?? ""));
      }
    }
    const retry = this.contentEl.createEl("button", { text: "Retry all", cls: "mod-cta" });
    retry.addEventListener("click", () => { void this.plugin.flushQueue(true).then(() => this.close()); });
  }

  onClose(): void { this.contentEl.empty(); }
}

class KairoSettingTab extends PluginSettingTab {
  private usageSummaryEl?: HTMLElement;

  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.plugin.support.addDiagnosticsSetting(containerEl);
    containerEl.createEl("p", { text: "Local-first capture. The optional Electron shortcut is active while Obsidian is running; the Obsidian command hotkey is always available as a fallback." });

    new Setting(containerEl).setName("Billing & usage").setHeading();
    containerEl.createEl("p", { text: "Each capture uses 1 credit. Billing accounts get 3 free captures per UTC day across all linked installations. Paid packs are one-time purchases: $1 for 100 uses or $10 for 1,000 uses." });
    this.usageSummaryEl = containerEl.createEl("p", { cls: "kairo-usage-summary", attr: { role: "status", "aria-live": "polite" } });
    this.renderUsageSummary();
    addBillingAccountSettings(containerEl, {
      state: this.plugin.settings,
      appId: "kairo-quick-capture",
      installationId: this.plugin.settings.constanceDeviceId,
      appVersion: this.plugin.manifest.version,
      persist: () => this.plugin.persist(),
      syncBalance: () => syncPurchasedUses(this.plugin),
      refresh: () => this.display(),
    });
    new Setting(containerEl).setName("Buy capture uses").setDesc("Opens TutivSoft Constance checkout in your browser. Purchases are one-time and linked to this installation.").addButton((button) => button.setButtonText("Buy $1 · 100 uses").onClick(() => openBuyCheckout(this.plugin, "usd_001"))).addButton((button) => button.setButtonText("Buy $10 · 1,000 uses").setCta().onClick(() => openBuyCheckout(this.plugin, "usd_010")));
    new Setting(containerEl).setName("Refresh purchased balance").setDesc("Pull the latest purchased-use balance from Constance.").addButton((button) => button.setButtonText("Refresh").onClick(async () => { button.setDisabled(true); await syncPurchasedUses(this.plugin); this.renderUsageSummary(); button.setDisabled(false); }));

    new Setting(containerEl).setName("Global shortcut").setDesc("Desktop accelerator, for example Ctrl+Shift+Space. Restart the shortcut after editing.").addText((text) => text.setValue(this.plugin.settings.shortcut).onChange(async (value) => { this.plugin.settings.shortcut = value.trim() || DEFAULT_SETTINGS.shortcut; this.plugin.refreshShortcut(); await this.plugin.persist(); }));
    new Setting(containerEl).setName("Vault folder").setDesc("Optional folder inside the current vault. Kairo never writes outside the current vault.").addText((text) => text.setPlaceholder("Leave blank for vault root").setValue(this.plugin.settings.vaultFolder).onChange(async (value) => { this.plugin.settings.vaultFolder = normalizeVaultPath(value); await this.plugin.persist(); }));
    new Setting(containerEl).setName("Destination mode").setDesc("Choose one inbox file or a dated daily-note folder.").addDropdown((dropdown) => dropdown.addOptions({ inbox: "Inbox file", daily: "Daily note" }).setValue(this.plugin.settings.destinationMode).onChange(async (value) => { this.plugin.settings.destinationMode = value as "inbox" | "daily"; await this.plugin.persist(); this.display(); }));
    new Setting(containerEl).setName("Inbox file").setDesc("Relative Markdown path used in inbox mode.").addText((text) => text.setValue(this.plugin.settings.inboxPath).onChange(async (value) => { this.plugin.settings.inboxPath = normalizeVaultPath(value) || DEFAULT_SETTINGS.inboxPath; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Daily-note folder").setDesc("Relative folder used in daily-note mode.").addText((text) => text.setValue(this.plugin.settings.dailyFolder).onChange(async (value) => { this.plugin.settings.dailyFolder = normalizeVaultPath(value); await this.plugin.persist(); }));
    new Setting(containerEl).setName("Daily-note format").setDesc("Filename format: YYYY, MM, DD, HH, mm, ss.").addText((text) => text.setValue(this.plugin.settings.dailyFormat).onChange(async (value) => { this.plugin.settings.dailyFormat = value || DEFAULT_SETTINGS.dailyFormat; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Timestamp format").setDesc("Template time format: YYYY, MM, DD, HH, mm, ss.").addText((text) => text.setValue(this.plugin.settings.timestampFormat).onChange(async (value) => { this.plugin.settings.timestampFormat = value || DEFAULT_SETTINGS.timestampFormat; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Capture template").setDesc("Use {{time}}, {{source}}, {{text}}, and {{id}}. The id marker prevents duplicate retries.").addTextArea((text) => text.setValue(this.plugin.settings.template).onChange(async (value) => { this.plugin.settings.template = value || DEFAULT_TEMPLATE; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Create missing destinations").setDesc("When enabled, Kairo creates the configured Markdown file on the first capture.").addToggle((toggle) => toggle.setValue(this.plugin.settings.createMissing).onChange(async (value) => { this.plugin.settings.createMissing = value; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Close after saving").setDesc("Close the scratchpad after a successful save.").addToggle((toggle) => toggle.setValue(this.plugin.settings.closeAfterSaving).onChange(async (value) => { this.plugin.settings.closeAfterSaving = value; await this.plugin.persist(); }));
    new Setting(containerEl).setName("Launch at login").setDesc("Optional desktop convenience. Disabled by default and handled locally by Electron when supported.").addToggle((toggle) => toggle.setValue(this.plugin.settings.launchAtLogin).onChange(async (value) => { this.plugin.settings.launchAtLogin = value; this.plugin.applyLaunchAtLogin(); await this.plugin.persist(); }));
    new Setting(containerEl).setName("Queue").setDesc(`${this.plugin.queue.length} capture${this.plugin.queue.length === 1 ? "" : "s"} waiting for delivery.`).addButton((button) => button.setButtonText("Show queue").onClick(() => new QueueModal(this.app, this.plugin).open())).addButton((button) => button.setButtonText("Flush now").onClick(() => void this.plugin.flushQueue(true)));
    new Setting(containerEl).setName("Validate destination").setDesc("Check the configured destination without writing a test note.").addButton((button) => button.setButtonText("Validate").onClick(async () => { const result = await this.plugin.validateDestination(); new Notice(result.ok ? `Kairo: destination ready at ${result.path}.` : `Kairo: ${result.reason ?? "destination is not ready"}`); }));
    void syncPurchasedUses(this.plugin).then(() => this.renderUsageSummary());
  }

  private renderUsageSummary(): void {
    if (!this.usageSummaryEl) return;
    normalizeBillingSettings(this.plugin.settings);
    const total = this.plugin.settings.freeUsesRemaining + this.plugin.settings.purchasedUses;
    const account = this.plugin.settings.billingAccountLinked ? "account linked" : "sign in required";
    this.usageSummaryEl.setText(`Uses remaining: ${total.toLocaleString()} (${this.plugin.settings.freeUsesRemaining} free today + ${this.plugin.settings.purchasedUses.toLocaleString()} purchased; ${account})`);
  }
}
