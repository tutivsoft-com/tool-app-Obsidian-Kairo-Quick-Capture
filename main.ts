import { selectedFiles, markdownFile, registerSelectionAction } from "./src/selection-scope";
import { diagnostics } from "./src/diagnostics";
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
  pollAuthenticatedCheckout,
  retryPendingSpendEvents,
  syncPurchasedUses,
} from "./src/billing";
import { PluginSupport } from "./src/plugin-support";
import { reserveNative, renderNativePacks, jobId, codePoints, recoverNative } from "./src/native-operations";
import { addBillingAccountSettings } from "./src/constance-account";

const VERSION = "3.4.63";
const DEFAULT_TEMPLATE = "- {{time}} — {{text}}\n";
const DEFAULT_SETTINGS: KairoSettings = {
  settingsMode: "simple",
  debugLogging: false,
  shortcut: "Ctrl+Shift+Space",
  vaultFolder: "",
  destinationMode: "inbox",
  inboxPath: "Inbox.md",
  dailyFolder: "Daily",
  dailyFormat: "YYYY-MM-DD",
  template: DEFAULT_TEMPLATE,
  timestampFormat: "YYYY-MM-DD HH:mm",
  createMissing: true,
  automaticDeliveryApproved: true,
  closeAfterSaving: true,
  enterSaves: true,
  launchAtLogin: false,
  constanceDeviceId: "",
  billingEmail: "",
  billingAccessToken: "",
  billingRefreshToken: "",
  billingAccessTokenExpiresAt: 0,
  billingAccountLinked: false,
  freeUsesRemaining: 3,
  freeUsesDay: currentDayKey(),
  purchasedUses: 0,
  pendingSpendEvents: [],
};

export interface KairoSettings {
  settingsMode: "simple" | "advanced";
  debugLogging?: boolean;
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
  enterSaves?: boolean;
  launchAtLogin: boolean;
  constanceDeviceId: string;
  billingEmail: string;
  billingAccessToken: string;
  billingRefreshToken: string;
  billingAccessTokenExpiresAt: number;
  billingAccountLinked: boolean;
  automaticDeliveryApproved?: boolean;
  freeUsesRemaining: number;
  freeUsesDay: string;
  purchasedUses: number;
  completedCaptureCharges?: string[];
  pendingSpendEvents: Array<{ eventId: string; amount: number }>;
}

interface QueuedCapture {
  id: string;
  createdAt: number;
  destination: string;
  entry: string;
  attempts: number;
  lastError?: string;
  billingPending?: boolean;
  nativeReservation?: boolean;
  inputCharacters?: number;
  nativeSource?: string;
  nativeResult?: string;
  billingOwner?: string;
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

interface ElectronBridge {
  globalShortcut?: { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void };
  app?: { isReady?(): boolean; setLoginItemSettings?(settings: { openAtLogin: boolean }): void };
  getCurrentWindow?: () => { show(): void; focus(): void };
  remote?: ElectronBridge;
}
type ElectronRequire = (moduleName: string) => ElectronBridge;

export default class KairoQuickCapturePlugin extends Plugin {
  support!: PluginSupport;
  settings: KairoSettings = { ...DEFAULT_SETTINGS };
  queue: QueuedCapture[] = [];
  private globalShortcut?: string;
  private captureStatus?: HTMLElement;
  private checkoutPollTimer?: number;
  private persistChain: Promise<void> = Promise.resolve();
  private deliveryChain: Promise<void> = Promise.resolve();
  private queueFlushPromise?: Promise<void>;

  async onload(): Promise<void> {
let diagnosticStartupEnd: () => void = () => {};

const diagnosticEnd1 = diagnostics?.start?.("main.onload") ?? (() => {});
try {

    this.support = new PluginSupport(this, { name: "Kairo Quick Capture", summary: "Capture ideas quickly to an inbox or daily note, including while the target is unavailable.", quickStart: ["Click the Kairo capture button in the left ribbon, or press Ctrl+Shift+K (Cmd+Shift+K on macOS).", "Type your idea and save. Inbox.md is the default destination; no destination setup is needed.", "Captures are saved locally immediately. Connect your account to deliver them to your note; open Queued captures to read or copy anything waiting."], commands: ["Open quick capture", "Show queued captures", "Deliver queued captures"], troubleshooting: ["Use Copy diagnostic log before reporting a problem.", "Check the destination when queued captures are not delivered."] });
    this.support.start();
    const data = (await this.loadData()) as Partial<KairoData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
diagnosticStartupEnd = diagnostics?.start?.("startup.initialize") ?? (() => {});

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
    this.addRibbonIcon("pencil-line", "Kairo: Open quick capture", () => this.openCapture());
    this.captureStatus = this.addStatusBarItem();
    this.captureStatus.setAttribute("role", "button");
    this.captureStatus.setAttribute("tabindex", "0");
    const openStatus = () => this.queue.length ? new QueueModal(this.app, this).open() : this.openCapture();
    this.registerDomEvent(this.captureStatus, "click", openStatus);
    this.registerDomEvent(this.captureStatus, "keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openStatus(); }
    });
    this.updateCaptureStatus();
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => diagnostics.guard("main.event_1", () => (this.addEditorMenuItems(menu, editor, info.file)))));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => diagnostics.guard("main.event_2", () => (this.addFileMenuItems(menu, file)))));
    this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => diagnostics.guard("main.event_3", () => (this.addFilesMenuItems(menu, files)))));
    this.addCommand({
      id: "flush-queue",
      name: "Deliver queued captures",
      callback: () => this.flushQueue(true),
    });
    this.addCommand({
      id: "show-queue",
      name: "Show queued captures",
      callback: () => new QueueModal(this.app, this).open(),
    });
    registerSelectionAction(this, { name: "Kairo: Capture links in this folder", icon: "links-coming-in", accepts: markdownFile, folders: true, multiple: false,
      run: files => this.openCapture(files.map(file => `[[${file.path.replace(/\.md$/i, "")}]]`).join("\n")) });
    this.addSettingTab(new KairoSettingTab(this.app, this));
    this.support.showWelcome();

    this.registerInterval(window.setInterval(() => diagnostics.guard("main.timer_4", () => (void (this.settings.automaticDeliveryApproved && this.flushQueue(false)))), 60_000));
    this.registerDomEvent(window, "online", () => {
return diagnostics.guard("main.event_5", () => { if (this.settings.automaticDeliveryApproved) void diagnostics.guard("main.background_6", () => (this.flushQueue(false)));
});
});
    this.app.workspace.onLayoutReady(() => {
return diagnostics.guard("main.event_7", () => {
      this.registerGlobalShortcut();
      this.showShortcutNotice();
      if (this.settings.automaticDeliveryApproved) void diagnostics.guard("main.background_8", () => (this.flushQueue(false)));
      void diagnostics.guard("main.background_9", () => (recoverNative({app:this.app,settings:this.settings,persistNative:()=>this.persist()})));
      void diagnostics.guard("main.background_10", () => (syncPurchasedUses(this).then(() => retryPendingSpendEvents(this))));

});
});

} catch (diagnosticError1) { diagnostics?.failure?.("main.onload", diagnosticError1); throw diagnosticError1; } finally { diagnosticStartupEnd();  diagnostics?.legacy?.("info", "startup.finished"); diagnosticEnd1(); }
}

  onunload(): void {
return diagnostics.guard("main.onunload_11", () => {
const diagnosticAction2 = () => {

    this.unregisterGlobalShortcut();
    if (this.checkoutPollTimer !== undefined) window.clearInterval(this.checkoutPollTimer);

}; return diagnostics?.run ? diagnostics.run("main.onunload", diagnosticAction2) : diagnosticAction2();

});
}

  async persist(): Promise<void> {
const diagnosticEnd3 = diagnostics?.start?.("main.persist") ?? (() => {});
try {

    const snapshot: KairoData = {
      settings: { ...this.settings },
      queue: this.queue.map((item) => ({ ...item })),
    };
    const write = this.persistChain.catch((rejectedError1) => { diagnostics.failure("main.rejected_2", rejectedError1); return (undefined); }).then(() => this.saveData(snapshot));
    this.persistChain = write;
    await write;
    this.updateCaptureStatus();

} catch (diagnosticError3) { diagnostics?.failure?.("main.persist", diagnosticError3); throw diagnosticError3; } finally { diagnosticEnd3(); }
}

  private updateCaptureStatus(): void {
    if (!this.captureStatus) return;
    this.captureStatus.setText(this.queue.length ? `Kairo: ${this.queue.length} queued` : "Kairo: Capture");
    this.captureStatus.setAttribute("aria-label", this.queue.length ? "Kairo: Open queued captures" : "Kairo: Open quick capture");
    this.captureStatus.setAttribute("title", this.queue.length ? "Read, copy, or deliver your saved captures" : "Open quick capture (Ctrl+Shift+K)");
  }

  openAccount(): void {
    const settings = (this.app as App & { setting: { open(): void; openTabById(id: string): void } }).setting;
    settings.open();
    settings.openTabById(this.manifest.id);
  }

  shortcutUsageMessage(): string {
    const usage = `Global capture shortcut: ${this.settings.shortcut}. Keep Obsidian running in the background; it can be minimized. `;
    return usage + (this.globalShortcut
      ? "Press the shortcut from any app to bring Obsidian forward and open Quick capture."
      : "This shortcut is currently unavailable or already in use. Use the Kairo pencil button or Ctrl+Shift+K (Cmd+Shift+K on macOS) inside Obsidian.");
  }

  private showShortcutNotice(): void {
    // Renderer lifetime matches a vault load; plugin reloads must not repeat the reminder.
    const session = window as Window & { kairoShortcutNoticeShown?: boolean };
    if (session.kairoShortcutNoticeShown) return;
    session.kairoShortcutNoticeShown = true;
    const message = document.createDocumentFragment();
    message.append(`Kairo Quick Capture — ${this.shortcutUsageMessage()} Default destination: ${this.destinationFor()}. `);
    const button = document.createElement("button");
    button.textContent = "Open capture";
    button.addEventListener("click", () => this.openCapture());
    message.append(button);
    new Notice(message, 12_000);
  }

  globalShortcutDescription(): string {
    return this.globalShortcut
      ? `Active: ${this.globalShortcut}. Obsidian must be running.`
      : "Global shortcut is unavailable or already in use. Use the capture button or Ctrl+Shift+K inside Obsidian.";
  }

  openCapture(initialText = ""): void {
    new CaptureModal(this.app, this, initialText).open();
  }

  private addEditorMenuItems(menu: Menu, editor: Editor, file: TFile | null): void {
    const selection = editor.getSelection().trim();
    if (selection) menu.addItem((item) => item.setTitle("Kairo: Quick capture selected text").setIcon("capture").onClick(() => {
return diagnostics.guard("main.control_12", () => { const diagnosticAction4 = () => (this.openCapture(selection)); return diagnostics?.run ? diagnostics.run("control.6968.onClick", diagnosticAction4) : diagnosticAction4();
});
}));
    if (file instanceof TFile && file.extension.toLowerCase() === "md") this.addNoteLinkMenuItem(menu, file);
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (file instanceof TFile && file.extension.toLowerCase() === "md") this.addNoteLinkMenuItem(menu, file);
  }

  private addFilesMenuItems(menu: Menu, selected: TAbstractFile[]): void {
    const paths = new Set(selectedFiles(selected, markdownFile).map(file => file.path));

    const links = [...paths].map((path) => this.app.vault.getAbstractFileByPath(path)).filter((file): file is TFile => file instanceof TFile).map((file) => `[[${file.path.replace(/\.md$/i, "")}]]`);
    if (links.length > 0) menu.addItem((item) => item.setTitle(`Kairo: Capture links to ${links.length} selected notes`).setIcon("links-coming-in").onClick(() => {
return diagnostics.guard("main.control_13", () => { const diagnosticAction5 = () => (this.openCapture(links.join("\n"))); return diagnostics?.run ? diagnostics.run("control.8054.onClick", diagnosticAction5) : diagnosticAction5();
});
}));
  }

  private addNoteLinkMenuItem(menu: Menu, file: TFile): void {
    menu.addItem((item) => item.setTitle("Kairo: Quick capture link to this note").setIcon("link").onClick(() => {
return diagnostics.guard("main.control_14", () => { const diagnosticAction6 = () => (this.openCapture(`[[${file.path.replace(/\.md$/i, "")}]]`)); return diagnostics?.run ? diagnostics.run("control.8273.onClick", diagnosticAction6) : diagnosticAction6();
});
}));
  }

  destinationFor(date = new Date()): string {
    const relative = this.settings.destinationMode === "daily"
      ? dailyNotePath(this.settings.dailyFolder, date, this.settings.dailyFormat)
      : normalizeVaultPath(this.settings.inboxPath);
    return joinVaultPath(this.settings.vaultFolder, relative);
  }

  async capture(text: string): Promise<{ state: "saved" | "queued" | "failed"; id: string; diagnostic?: string }> {
const diagnosticEnd7 = diagnostics?.start?.("main.capture") ?? (() => {});
try {

    const trimmed = text.trimEnd();
    if (!trimmed.trim()) throw new Error("Capture is empty.");
    const id = this.makeId();
    const now = new Date();
    const destination = this.destinationFor(now);
    const entry = renderTemplate(this.settings.template, {
      time: formatTimestamp(now, this.settings.timestampFormat),
      source: "Obsidian",
      text: trimmed,
      id,
    });
    // Save the idea before any account or network request. Delivery keeps the
    // existing reserve/write/verify/commit flow and reuses this capture ID.
    const queued: QueuedCapture = { id, createdAt: now.getTime(), destination, entry, attempts: 0, billingPending: true, nativeReservation: true, inputCharacters: codePoints(trimmed), nativeSource: trimmed, nativeResult: `${entry}${entry.endsWith("\n") ? "" : "\n"}<!-- kairo:${id} -->\n`, billingOwner: this.settings.billingAccountLinked ? this.settings.billingEmail.trim().toLowerCase() : undefined };
    this.queue.push(queued);
    try { await this.persist(); }
    catch (error) {
diagnostics.failure("main.caught_15", error); this.queue = this.queue.filter(item => item.id !== id); return { state: "failed", id, diagnostic: diagnosticSummary(destination, error, id) }; }
    if (!this.settings.billingAccountLinked || !this.settings.billingAccessToken || window.navigator?.onLine === false) {
      return { state: "queued", id, diagnostic: "Saved locally. Delivery will resume when your account and connection are ready." };
    }
    try { await this.flushQueue(false); }
    catch (error) {
diagnostics.failure("main.caught_16", error); return { state: "queued", id, diagnostic: diagnosticSummary(destination, error, id) }; }
    const pending = this.queue.find(item => item.id === id);
    return pending ? { state: "queued", id, diagnostic: pending.lastError } : { state: "saved", id };

} catch (diagnosticError7) { diagnostics?.failure?.("main.capture", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}

  async flushQueue(showNotice: boolean): Promise<void> {
const diagnosticEnd8 = diagnostics?.start?.("main.flushQueue") ?? (() => {});
try {

    if (this.queueFlushPromise) return await (this.queueFlushPromise);
    const run = this.flushQueueInternal(showNotice);
    const completion = run.finally(() => {
      if (this.queueFlushPromise === completion) this.queueFlushPromise = undefined;
    });
    this.queueFlushPromise = completion;
    return await (completion);

} catch (diagnosticError8) { diagnostics?.failure?.("main.flushQueue", diagnosticError8); throw diagnosticError8; } finally { diagnosticEnd8(); }
}

  private async flushQueueInternal(showNotice: boolean): Promise<void> {
const diagnosticEnd9 = diagnostics?.start?.("main.flushQueueInternal") ?? (() => {});
try {

    if (!this.queue.length) {
      if (showNotice) new Notice("Kairo queue is empty.");
      return;
    }
    if (!this.settings.billingAccountLinked || !this.settings.billingAccessToken || window.navigator?.onLine === false) {
      if (showNotice) new Notice("Your captures are saved locally. Connect your account and go online to deliver them.", 8000);
      return;
    }
    const pending = [...this.queue].sort((a, b) => a.createdAt - b.createdAt);
    const pendingIds = new Set(pending.map((item) => item.id));
    const remaining: QueuedCapture[] = [];
    let delivered = 0;
    for (const item of pending) {
      try {
        if (item.nativeReservation) {
          if (!this.settings.billingAccountLinked || !this.settings.billingAccessToken) throw new Error("Saved locally. Connect your account in Settings to deliver queued captures.");
          const owner = this.settings.billingEmail.trim().toLowerCase();
          if (item.billingOwner && item.billingOwner !== owner) throw new Error("Saved locally. Connect the original account to deliver this capture.");
          if (!item.billingOwner) { item.billingOwner = owner; await this.persist(); }
        }
        if (item.billingPending && !item.nativeReservation) {
          if (!await consumeCaptureUse(this, `evt_${item.id}`)) throw new Error("Capture is saved in the queue; billing is pending. Connect or add credits to continue.");
          item.billingPending = false;
          await this.persist();
        }
        const reservation = item.nativeReservation ? await reserveNative({app:this.app,settings:this.settings,persistNative:()=>this.persist()}, "kairo-quick-capture", `evt_${item.id}`, item.nativeSource || item.entry, item.nativeResult || item.entry, {input_characters:item.inputCharacters || codePoints(item.entry)}) : null;
        if (item.nativeReservation && !reservation) throw new Error("This capture is awaiting account confirmation. Nothing has been delivered.");
        const writeNeeded=reservation ? await reservation.markWriting([{path:item.destination,marker:`<!-- kairo:${item.id} -->`}]) : true;
        if(writeNeeded)await this.appendSafely(item.destination, item.entry, item.id);
        const written = this.app.vault.getAbstractFileByPath(item.destination);
        if (!(written instanceof TFile) || !(await this.app.vault.read(written)).includes(`<!-- kairo:${item.id} -->`)) throw new Error("Capture delivery could not be confirmed. Check the destination before retrying the saved capture.");
        if (reservation && (await reservation.commit()).kind !== "committed") throw new Error("Capture delivered. The charge is awaiting confirmation. Retry this capture to check its status.");
        delivered++;
      } catch (error) {
diagnostics.failure("main.caught_17", error);
        remaining.push({ ...item, attempts: item.attempts + 1, lastError: diagnosticSummary(item.destination, error, item.id) });
      }
    }
    // A capture can be queued while delivery is awaiting a vault read/write.
    // Keep those newer entries instead of replacing them with this flush's
    // earlier snapshot.
    const addedDuringFlush = this.queue.filter((item) => !pendingIds.has(item.id));
    this.queue = [...remaining, ...addedDuringFlush].sort((a, b) => a.createdAt - b.createdAt);
    this.settings.completedCaptureCharges = (this.settings.completedCaptureCharges ?? []).filter(id => this.queue.some(item => id === `evt_${item.id}`));
    await this.persist();
    if (showNotice) new Notice(remaining.length ? `Delivered ${delivered}; ${remaining.length} still queued.` : `Delivered ${delivered} queued capture${delivered === 1 ? "" : "s"}.`);

} catch (diagnosticError9) { diagnostics?.failure?.("main.flushQueueInternal", diagnosticError9); throw diagnosticError9; } finally { diagnosticEnd9(); }
}

  async validateDestination(): Promise<{ ok: boolean; path: string; reason?: string }> {
const diagnosticEnd10 = diagnostics?.start?.("main.validateDestination") ?? (() => {});
try {

    const path = this.destinationFor();
    if (!path) return { ok: false, path, reason: "Choose an inbox file or daily-note folder first." };
    const folder = this.settings.vaultFolder ? this.app.vault.getAbstractFileByPath(normalizeVaultPath(this.settings.vaultFolder)) : null;
    if (this.settings.vaultFolder && !(folder instanceof TFolder)) return { ok: false, path, reason: "Vault folder does not exist in the current vault." };
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && !(file instanceof TFile)) return { ok: false, path, reason: "The destination path is a folder, not a Markdown file." };
    if (!file && !this.settings.createMissing) return { ok: false, path, reason: "Destination is missing. Enable 'Create missing destinations' to allow creation." };
    return { ok: true, path };

} catch (diagnosticError10) { diagnostics?.failure?.("main.validateDestination", diagnosticError10); throw diagnosticError10; } finally { diagnosticEnd10(); }
}

  async appendSafely(path: string, entry: string, marker: string): Promise<void> {
const diagnosticEnd11 = diagnostics?.start?.("main.appendSafely") ?? (() => {});
try {

    const write = this.deliveryChain.catch((rejectedError3) => { diagnostics.failure("main.rejected_4", rejectedError3); return (undefined); }).then(() => this.appendSafelyUnlocked(path, entry, marker));
    this.deliveryChain = write;
    await write;

} catch (diagnosticError11) { diagnostics?.failure?.("main.appendSafely", diagnosticError11); throw diagnosticError11; } finally { diagnosticEnd11(); }
}

  private async appendSafelyUnlocked(path: string, entry: string, marker: string): Promise<void> {
const diagnosticEnd12 = diagnostics?.start?.("main.appendSafelyUnlocked") ?? (() => {});
try {

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
    await this.app.vault.process(file,current=>{if(current.includes(`<!-- kairo:${marker} -->`))return current;if(current!==contents)throw new DestinationChangedError();return appendText(current,markedEntry);});

} catch (diagnosticError12) { diagnostics?.failure?.("main.appendSafelyUnlocked", diagnosticError12); throw diagnosticError12; } finally { diagnosticEnd12(); }
}

  private async ensureParentFolders(path: string): Promise<void> {
const diagnosticEnd13 = diagnostics?.start?.("main.ensureParentFolders") ?? (() => {});
try {

    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new Error(`Cannot create destination folder: ${current} is a file.`);
      if (!existing) await this.app.vault.createFolder(current);
    }

} catch (diagnosticError13) { diagnostics?.failure?.("main.ensureParentFolders", diagnosticError13); throw diagnosticError13; } finally { diagnosticEnd13(); }
}

  copyDiagnostic(summary: string): void {
    const write = navigator.clipboard?.writeText(summary);
    if (write) void diagnostics.guard("main.background_18", () => (write.then(() => new Notice("Diagnostic copied. Captured text was not included."))));
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
      if (electron.globalShortcut.register(this.settings.shortcut, () => {
        const currentWindow = electron.getCurrentWindow?.();
        currentWindow?.show();
        currentWindow?.focus();
        this.openCapture();
      })) this.globalShortcut = this.settings.shortcut;
    } catch (caughtError19) {
diagnostics.failure("main.caught_20", caughtError19);
      // Obsidian's command hotkey remains available when Electron rejects the accelerator.
    }
  }

  private unregisterGlobalShortcut(): void {
    if (!this.globalShortcut) return;
    try { this.electron()?.globalShortcut?.unregister(this.globalShortcut); } catch (caughtError21) {
diagnostics.failure("main.caught_22", caughtError21); /* best effort */ }
    this.globalShortcut = undefined;
  }

  applyLaunchAtLogin(): void {
    try { this.electron()?.app?.setLoginItemSettings?.({ openAtLogin: this.settings.launchAtLogin }); } catch (caughtError23) {
diagnostics.failure("main.caught_24", caughtError23); /* platform optional */ }
  }

  refreshShortcut(): void {
    this.registerGlobalShortcut();
  }

  pollAfterCheckout(checkoutId?: string): void {
    if (this.checkoutPollTimer !== undefined) window.clearInterval(this.checkoutPollTimer);
    let attempts = 0;
    this.checkoutPollTimer = window.setInterval(() => {
return diagnostics.guard("main.timer_25", () => {
      attempts += 1;
      void diagnostics.guard("main.background_26", () => ((async () => {
const diagnosticEnd14 = diagnostics?.start?.("main.background.19067") ?? (() => {});
try {

        const settled = checkoutId ? await pollAuthenticatedCheckout(this, checkoutId).catch((rejectedError5) => { diagnostics.failure("main.rejected_6", rejectedError5); return (false); }) : false;
        if (settled) await syncPurchasedUses(this);
        else if (!checkoutId) await syncPurchasedUses(this);
        if ((settled || attempts >= 6) && this.checkoutPollTimer !== undefined) {
          window.clearInterval(this.checkoutPollTimer);
          this.checkoutPollTimer = undefined;
        }

} catch (diagnosticError14) { diagnostics?.failure?.("main.background.19067", diagnosticError14); throw diagnosticError14; } finally { diagnosticEnd14(); }
})()));

});
}, 15_000);
  }

  private electron(): ReturnType<ElectronRequire> | undefined {
    const requireFn = (window as Window & { require?: ElectronRequire }).require;
    if (!requireFn) return undefined;
    try { const electron = requireFn("electron"); return electron.globalShortcut ? electron : electron.remote; } catch (caughtError27) {
diagnostics.failure("main.caught_28", caughtError27); return undefined; }
  }
}

class CaptureModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private status!: HTMLElement;
  private diagnostic?: string;
  private submitting = false;

  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin, private readonly initialText = "") { super(app); }

  onOpen(): void {
return diagnostics.guard("main.onOpen_29", () => {
const diagnosticAction15 = () => {

    this.modalEl.addClass("kairo-capture-modal");
    this.titleEl.setText("Quick capture");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Save ideas immediately. Destination: ${this.plugin.destinationFor()}.` });
    this.contentEl.createEl("p", { text: this.plugin.settings.billingAccountLinked
      ? "If delivery is unavailable, your capture stays saved in Queued captures."
      : "No setup is needed to save locally. Connect your account to deliver captures to your note." });
    this.textarea = this.contentEl.createEl("textarea", { attr: { "aria-label": "Capture text", rows: "7", placeholder: "What do you want to remember?" } });
    this.textarea.value = this.initialText;
    this.status = this.contentEl.createDiv({ cls: "kairo-status", attr: { role: "status", "aria-live": "polite" } });
    this.status.setText("Ready");
    const actions = this.contentEl.createDiv({ cls: "kairo-actions" });
    const save = actions.createEl("button", { text: "Save" });
    const saveClose = actions.createEl("button", { text: "Save and close", cls: "mod-cta" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    save.addEventListener("click", () => diagnostics.guard("main.event_30", () => (void diagnostics.guard("main.background_31", () => (this.submit(false))))));
    saveClose.addEventListener("click", () => diagnostics.guard("main.event_32", () => (void diagnostics.guard("main.background_33", () => (this.submit(true))))));
    cancel.addEventListener("click", () => diagnostics.guard("main.event_34", () => (this.close())));
    const access = this.contentEl.createDiv({ cls: "kairo-actions" });
    const queue = access.createEl("button", { text: "Queued captures" });
    queue.addEventListener("click", () => new QueueModal(this.app, this.plugin).open());
    if (!this.plugin.settings.billingAccountLinked) {
      const account = access.createEl("button", { text: "Connect account for delivery" });
      account.addEventListener("click", () => { void diagnostics.guard("capture.open-account", async () => {
        if (this.textarea.value.trim()) {
          await this.submit(false);
          if (this.textarea.value.trim()) return;
        }
        this.close();
        this.plugin.openAccount();
      }); });
    }
    this.contentEl.createEl("small", { text: this.plugin.settings.enterSaves !== false
      ? "Enter saves · Ctrl/Cmd+Enter or Shift+Enter adds a line · Escape closes"
      : "Ctrl/Cmd+Enter saves · Enter adds a line · Escape closes" });
    this.textarea.addEventListener("keydown", (event) => {
return diagnostics.guard("main.event_35", () => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
      const modified = event.ctrlKey || event.metaKey;
      const save = this.plugin.settings.enterSaves !== false ? !modified : modified;
      if (save) {
        event.preventDefault();
        if (!event.repeat) void diagnostics.guard("main.background_36", () => this.submit(this.plugin.settings.closeAfterSaving));
      } else if (modified) {
        event.preventDefault();
        this.textarea.setRangeText("\n", this.textarea.selectionStart, this.textarea.selectionEnd, "end");
        this.textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }

});
});
    window.setTimeout(() => diagnostics.guard("main.timer_37", () => (this.textarea.focus())), 20);

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction15) : diagnosticAction15();

});
}

  private async submit(closeAfter: boolean): Promise<void> {
const diagnosticEnd16 = diagnostics?.start?.("main.submit") ?? (() => {});
try {

    if (this.submitting) return;
    if (!this.textarea.value.trim()) { this.status.setText("Enter some text first."); return; }
    this.submitting = true;
    this.status.setText("Saving…");
    try {
      const result = await this.plugin.capture(this.textarea.value);
      if (result.state === "saved") {
        this.textarea.value = "";
        this.status.setText(`Saved to ${this.plugin.destinationFor()}.`);
        new Notice(`Capture saved to ${this.plugin.destinationFor()}.`);
        if (closeAfter) this.close();
      } else if (result.state === "queued") {
        this.diagnostic = result.diagnostic;
        this.textarea.value = "";
        const message = this.plugin.settings.billingAccountLinked
          ? "Saved locally — delivery is waiting. Open Queued captures to read or retry it."
          : "Saved locally — connect your account to deliver it. Open Queued captures to read or copy it.";
        this.status.setText(message);
        new Notice(message, 8000);
        this.addDiagnosticAction();
        if (closeAfter) this.close();
      } else {
        this.diagnostic = result.diagnostic;
        this.status.setText("The capture could not be saved. Your text is still here; retry or copy it before closing.");
        new Notice("Capture was not saved. Your text is still in the capture window.", 8000);
        this.addDiagnosticAction();
      }
    } catch (error) {
diagnostics.failure("main.caught_38", error);
      this.status.setText(error instanceof Error ? error.message : "Could not save capture.");
    } finally {
      this.submitting = false;
    }

} catch (diagnosticError16) { diagnostics?.failure?.("main.submit", diagnosticError16); throw diagnosticError16; } finally { diagnosticEnd16(); }
}

  private addDiagnosticAction(): void {
    if (!this.diagnostic) return;
    const copy = this.contentEl.createEl("button", { text: "Copy diagnostic" });
    copy.addEventListener("click", () => diagnostics.guard("main.event_39", () => (this.plugin.copyDiagnostic(this.diagnostic ?? ""))));
  }

  onClose(): void {
return diagnostics.guard("main.onClose_40", () => {
const diagnosticAction17 = () => {
 this.contentEl.empty();
}; return diagnostics?.run ? diagnostics.run("main.onClose", diagnosticAction17) : diagnosticAction17();

});
}
}

class QueueModal extends Modal {
  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin) { super(app); }

  onOpen(): void {
return diagnostics.guard("main.onOpen_41", () => {
const diagnosticAction18 = () => {

    this.titleEl.setText("Queued captures");
    this.contentEl.empty();
    if (!this.plugin.queue.length) { this.contentEl.createEl("p", { text: "Nothing is waiting for delivery." }); return; }
    this.contentEl.createEl("p", { text: `${this.plugin.queue.length} capture${this.plugin.queue.length === 1 ? "" : "s"} waiting. Captured text stays in this vault's plugin data until delivery.` });
    if (!this.plugin.settings.billingAccountLinked) {
      this.contentEl.createEl("p", { text: "Your ideas are saved here. Connect your account to deliver them to your notes." });
      const account = this.contentEl.createEl("button", { text: "Connect account for delivery" });
      account.addEventListener("click", () => { this.close(); this.plugin.openAccount(); });
    }
    const list = this.contentEl.createEl("ul", { cls: "kairo-queue-list" });
    for (const item of [...this.plugin.queue].sort((a, b) => a.createdAt - b.createdAt)) {
      const row = list.createEl("li");
      row.createEl("strong", { text: new Date(item.createdAt).toLocaleString() });
      row.createEl("span", { text: ` · ${item.destination} · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}` });
      const text = item.nativeSource ?? item.entry;
      row.createEl("pre", { text, cls: "kairo-queue-text" });
      const copyText = row.createEl("button", { text: "Copy capture text" });
      copyText.addEventListener("click", () => { void diagnostics.guard("queue.copy-text", async () => {
        await navigator.clipboard.writeText(text);
        new Notice("Capture text copied.");
      }); });
      if (item.lastError) {
        row.createEl("p", { text: item.lastError, cls: "kairo-queue-error" });
        const copy = row.createEl("button", { text: "Copy diagnostic" });
        copy.addEventListener("click", () => diagnostics.guard("main.event_42", () => (this.plugin.copyDiagnostic(item.lastError ?? ""))));
      }
    }
    const retry = this.contentEl.createEl("button", { text: "Retry delivery", cls: "mod-cta" });
    retry.addEventListener("click", () => {
return diagnostics.guard("main.event_43", () => { void diagnostics.guard("main.background_44", () => (this.plugin.flushQueue(true).then(() => { this.contentEl.empty(); this.onOpen(); })));
});
});

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction18) : diagnosticAction18();

});
}

  onClose(): void {
return diagnostics.guard("main.onClose_45", () => {
const diagnosticAction19 = () => {
 this.contentEl.empty();
}; return diagnostics?.run ? diagnostics.run("main.onClose", diagnosticAction19) : diagnosticAction19();

});
}
}

class KairoSettingTab extends PluginSettingTab {
  private usageSummaryEl?: HTMLElement;

  constructor(app: App, private readonly plugin: KairoQuickCapturePlugin) { super(app, plugin); }

  display(): void {
return diagnostics.guard("main.display_46", () => {
const diagnosticAction20 = () => {

    const { containerEl } = this;
    const diagnosticStage21 = diagnostics?.start?.("settings.render.clear") ?? (() => {});
containerEl.empty();
diagnosticStage21();

    const diagnosticStage22 = diagnostics?.start?.("settings.render.help") ?? (() => {});
new Setting(containerEl).setName("Ready to capture").setDesc(`Default destination: ${this.plugin.destinationFor()}. Save locally immediately; account connection enables delivery.`)
  .addButton(button => button.setButtonText("Open quick capture").setCta().onClick(() => { (this.app as App & { setting: { close(): void } }).setting.close(); this.plugin.openCapture(); }));
new Setting(containerEl).setName("Capture from another app").setDesc(this.plugin.shortcutUsageMessage());
this.plugin.support.addHelpSetting(containerEl);
diagnosticStage22();

this.plugin.support.addDebugSetting?.(containerEl);

    const diagnosticStage23 = diagnostics?.start?.("settings.render.settings_mode") ?? (() => {});
new Setting(containerEl).setName("Settings mode").setDesc("Simple shows everyday capture settings. Advanced adds formatting, startup, and troubleshooting.").addDropdown(d => d.addOptions({ simple: "Simple", advanced: "Advanced — optional" }).setValue(this.plugin.settings.settingsMode === "advanced" ? "advanced" : "simple").onChange(async value => {
return diagnostics.guard("main.control_47", async () => {
const diagnosticEnd48 = diagnostics?.start?.("control.settings_mode.onChange") ?? (() => {});
try {
 this.plugin.settings.settingsMode = value as "simple" | "advanced"; await this.plugin.persist(); this.display();
} catch (diagnosticError48) { diagnostics?.failure?.("control.settings_mode.onChange", diagnosticError48); throw diagnosticError48; } finally { diagnosticEnd48(); }

});
}));
diagnosticStage23();

    const advanced = this.plugin.settings.settingsMode === "advanced";
    const diagnosticStage24 = diagnostics?.start?.("settings.render.stage_1") ?? (() => {});
if (advanced) this.plugin.support.addDiagnosticsSetting(containerEl);
diagnosticStage24();

    const diagnosticStage25 = diagnostics?.start?.("settings.render.stage_2") ?? (() => {});
containerEl.createEl("p", { text: "Click the Kairo pencil button or press Ctrl+Shift+K (Cmd+Shift+K on macOS). No destination configuration is required." });
diagnosticStage25();


    const diagnosticStage26 = diagnostics?.start?.("settings.render.billing_usage") ?? (() => {});
new Setting(containerEl).setName("Billing & usage").setHeading();
diagnosticStage26();

    const diagnosticStage27 = diagnostics?.start?.("settings.render.stage_3") ?? (() => {});
containerEl.createEl("p", { text: "Each delivered capture uses one credit. Verified accounts receive five free captures on their account. Captures are saved locally, including offline. Connect your account to deliver them to your note." });
diagnosticStage27();

    const diagnosticStage28 = diagnostics?.start?.("settings.render.stage_4") ?? (() => {});
this.usageSummaryEl = containerEl.createEl("p", { cls: "kairo-usage-summary", attr: { role: "status", "aria-live": "polite" } });
diagnosticStage28();

    const diagnosticStage29 = diagnostics?.start?.("settings.render.stage_5") ?? (() => {});
this.renderUsageSummary();
diagnosticStage29();

    const diagnosticStage30 = diagnostics?.start?.("settings.render.account") ?? (() => {});
addBillingAccountSettings(containerEl, {
      state: this.plugin.settings,
      appId: "kairo-quick-capture",
      installationId: this.plugin.settings.constanceDeviceId,
      appVersion: this.plugin.manifest.version,
      persist: () => this.plugin.persist(),
      syncBalance: () => syncPurchasedUses(this.plugin),
      refresh: () => { this.display(); if (this.plugin.settings.automaticDeliveryApproved) void diagnostics.guard("main.background_48", () => (this.plugin.flushQueue(false))); },
    });
diagnosticStage30();

    const diagnosticStage31 = diagnostics?.start?.("settings.render.catalog") ?? (() => {});
void diagnostics.guard("main.background_49", () => (renderNativePacks(containerEl,{app:this.app,settings:this.plugin.settings,persistNative:()=>this.plugin.persist()},"kairo-quick-capture",async plan=>{
const diagnosticEnd49 = diagnostics?.start?.("main.background.26883") ?? (() => {});
try {
 const { openAccountCheckoutByPrice }=await import("./src/billing-checkout"); await openAccountCheckoutByPrice({state:this.plugin.settings,appId:"kairo-quick-capture",installationId:this.plugin.settings.constanceDeviceId,persist:()=>this.plugin.persist(),syncBalance:()=>syncPurchasedUses(this.plugin),refreshSession:async()=>{
const diagnosticEnd50 = diagnostics?.start?.("main.background.27213") ?? (() => {});
try {
const a=await import("./src/constance-account");return await (a.refreshBillingSession(this.plugin.settings,()=>this.plugin.persist()));
} catch (diagnosticError50) { diagnostics?.failure?.("main.background.27213", diagnosticError50); throw diagnosticError50; } finally { diagnosticEnd50(); }
}},plan);
} catch (diagnosticError49) { diagnostics?.failure?.("main.background.26883", diagnosticError49); throw diagnosticError49; } finally { diagnosticEnd49(); }
})));
diagnosticStage31();

    const diagnosticStage32 = diagnostics?.start?.("settings.render.automatic_delivery") ?? (() => {});
new Setting(containerEl).setName("Automatic delivery").setDesc("Deliver saved captures automatically when the destination and account are ready. On by default; turn off to retry delivery manually.").addToggle(t=>t.setValue(this.plugin.settings.automaticDeliveryApproved===true).onChange(async value=>{
return diagnostics.guard("main.control_50", async () => {
const diagnosticEnd51 = diagnostics?.start?.("control.automatic_delivery.onChange") ?? (() => {});
try {
this.plugin.settings.automaticDeliveryApproved=value;await this.plugin.persist();
} catch (diagnosticError51) { diagnostics?.failure?.("control.automatic_delivery.onChange", diagnosticError51); throw diagnosticError51; } finally { diagnosticEnd51(); }

});
}));
diagnosticStage32();

    const diagnosticStage33 = diagnostics?.start?.("settings.render.refresh_purchased_balance") ?? (() => {});
new Setting(containerEl).setName("Refresh balance").setDesc("Update your free and purchased credit balance.").addButton((button) => button.setButtonText("Refresh").onClick(async () => {
return diagnostics.guard("main.control_51", async () => {
const diagnosticEnd52 = diagnostics?.start?.("control.refresh_purchased_balance.onClick") ?? (() => {});
try {
 button.setDisabled(true); try { await syncPurchasedUses(this.plugin, true); this.renderUsageSummary(); new Notice("Kairo: balance refreshed."); } catch (caughtError52) {
diagnostics.failure("main.caught_53", caughtError52); new Notice("Kairo: balance refresh failed. Check your connection and try again."); } finally { button.setDisabled(false); }
} catch (diagnosticError52) { diagnostics?.failure?.("control.refresh_purchased_balance.onClick", diagnosticError52); throw diagnosticError52; } finally { diagnosticEnd52(); }

});
}));
diagnosticStage33();


    const diagnosticStage34 = diagnostics?.start?.("settings.render.global_shortcut") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Global shortcut").setDesc(this.plugin.globalShortcutDescription()).addText((text) => text.setValue(this.plugin.settings.shortcut).onChange(async (value) => {
return diagnostics.guard("main.control_54", async () => {
const diagnosticEnd53 = diagnostics?.start?.("control.global_shortcut.onChange") ?? (() => {});
try {
 this.plugin.settings.shortcut = value.trim() || DEFAULT_SETTINGS.shortcut; this.plugin.refreshShortcut(); await this.plugin.persist();
} catch (diagnosticError53) { diagnostics?.failure?.("control.global_shortcut.onChange", diagnosticError53); throw diagnosticError53; } finally { diagnosticEnd53(); }

});
}));
diagnosticStage34();

    const diagnosticStage35 = diagnostics?.start?.("settings.render.vault_folder") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Vault folder").setDesc("Optional folder inside the current vault. Kairo never writes outside the current vault.").addText((text) => text.setPlaceholder("Leave blank for vault root").setValue(this.plugin.settings.vaultFolder).onChange(async (value) => {
return diagnostics.guard("main.control_55", async () => {
const diagnosticEnd54 = diagnostics?.start?.("control.vault_folder.onChange") ?? (() => {});
try {
 this.plugin.settings.vaultFolder = normalizeVaultPath(value); await this.plugin.persist();
} catch (diagnosticError54) { diagnostics?.failure?.("control.vault_folder.onChange", diagnosticError54); throw diagnosticError54; } finally { diagnosticEnd54(); }

});
}));
diagnosticStage35();

    const diagnosticStage36 = diagnostics?.start?.("settings.render.destination_mode") ?? (() => {});
new Setting(containerEl).setName("Destination mode").setDesc("Choose one inbox file or a dated daily-note folder.").addDropdown((dropdown) => dropdown.addOptions({ inbox: "Inbox file", daily: "Daily note" }).setValue(this.plugin.settings.destinationMode).onChange(async (value) => {
return diagnostics.guard("main.control_56", async () => {
const diagnosticEnd55 = diagnostics?.start?.("control.destination_mode.onChange") ?? (() => {});
try {
 this.plugin.settings.destinationMode = value as "inbox" | "daily"; await this.plugin.persist(); this.display();
} catch (diagnosticError55) { diagnostics?.failure?.("control.destination_mode.onChange", diagnosticError55); throw diagnosticError55; } finally { diagnosticEnd55(); }

});
}));
diagnosticStage36();

    const diagnosticStage37 = diagnostics?.start?.("settings.render.inbox_file") ?? (() => {});
if (this.plugin.settings.destinationMode === "inbox") new Setting(containerEl).setName("Inbox file").setDesc("Relative Markdown path used in inbox mode.").addText((text) => text.setValue(this.plugin.settings.inboxPath).onChange(async (value) => {
return diagnostics.guard("main.control_57", async () => {
const diagnosticEnd56 = diagnostics?.start?.("control.inbox_file.onChange") ?? (() => {});
try {
 this.plugin.settings.inboxPath = normalizeVaultPath(value) || DEFAULT_SETTINGS.inboxPath; await this.plugin.persist();
} catch (diagnosticError56) { diagnostics?.failure?.("control.inbox_file.onChange", diagnosticError56); throw diagnosticError56; } finally { diagnosticEnd56(); }

});
}));
diagnosticStage37();

    const diagnosticStage38 = diagnostics?.start?.("settings.render.daily_note_folder") ?? (() => {});
if (this.plugin.settings.destinationMode === "daily") new Setting(containerEl).setName("Daily-note folder").setDesc("Relative folder used in daily-note mode.").addText((text) => text.setValue(this.plugin.settings.dailyFolder).onChange(async (value) => {
return diagnostics.guard("main.control_58", async () => {
const diagnosticEnd57 = diagnostics?.start?.("control.daily_note_folder.onChange") ?? (() => {});
try {
 this.plugin.settings.dailyFolder = normalizeVaultPath(value); await this.plugin.persist();
} catch (diagnosticError57) { diagnostics?.failure?.("control.daily_note_folder.onChange", diagnosticError57); throw diagnosticError57; } finally { diagnosticEnd57(); }

});
}));
diagnosticStage38();

    const diagnosticStage39 = diagnostics?.start?.("settings.render.daily_note_format") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Daily-note format").setDesc("Filename format: YYYY, MM, DD, HH, mm, ss.").addDropdown(d => d.addOptions({ [this.plugin.settings.dailyFormat]: this.plugin.settings.dailyFormat, ...{ "YYYY-MM-DD": "2026-09-30 (recommended)", "YYYY/MM/DD": "2026/09/30 (year/month folders)", "YYYYMMDD": "20260930 (compact)" } }).setValue(this.plugin.settings.dailyFormat).onChange(async value => {
return diagnostics.guard("main.control_59", async () => {
const diagnosticEnd58 = diagnostics?.start?.("control.daily_note_format.onChange") ?? (() => {});
try {
 this.plugin.settings.dailyFormat = value; await this.plugin.persist();
} catch (diagnosticError58) { diagnostics?.failure?.("control.daily_note_format.onChange", diagnosticError58); throw diagnosticError58; } finally { diagnosticEnd58(); }

});
}));
diagnosticStage39();

    const diagnosticStage40 = diagnostics?.start?.("settings.render.timestamp_format") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Timestamp format").setDesc("Template time format: YYYY, MM, DD, HH, mm, ss.").addDropdown(d => d.addOptions({ [this.plugin.settings.timestampFormat]: this.plugin.settings.timestampFormat, ...{ "YYYY-MM-DD HH:mm": "Date and time (recommended)", "HH:mm": "Time only", "YYYY-MM-DD HH:mm:ss": "Date, time, and seconds" } }).setValue(this.plugin.settings.timestampFormat).onChange(async value => {
return diagnostics.guard("main.control_60", async () => {
const diagnosticEnd59 = diagnostics?.start?.("control.timestamp_format.onChange") ?? (() => {});
try {
 this.plugin.settings.timestampFormat = value; await this.plugin.persist();
} catch (diagnosticError59) { diagnostics?.failure?.("control.timestamp_format.onChange", diagnosticError59); throw diagnosticError59; } finally { diagnosticEnd59(); }

});
}));
diagnosticStage40();

    const diagnosticStage41 = diagnostics?.start?.("settings.render.capture_template") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Capture template").setDesc("Use {{time}}, {{source}}, {{text}}, and {{id}}. The id marker prevents duplicate retries.").addTextArea((text) => text.setValue(this.plugin.settings.template).onChange(async (value) => {
return diagnostics.guard("main.control_61", async () => {
const diagnosticEnd60 = diagnostics?.start?.("control.capture_template.onChange") ?? (() => {});
try {
 this.plugin.settings.template = value || DEFAULT_TEMPLATE; await this.plugin.persist();
} catch (diagnosticError60) { diagnostics?.failure?.("control.capture_template.onChange", diagnosticError60); throw diagnosticError60; } finally { diagnosticEnd60(); }

});
}));
diagnosticStage41();

    const diagnosticStage42 = diagnostics?.start?.("settings.render.create_missing_destinations") ?? (() => {});
new Setting(containerEl).setName("Create missing destinations").setDesc("When enabled, Kairo creates the configured Markdown file on the first capture.").addToggle((toggle) => toggle.setValue(this.plugin.settings.createMissing).onChange(async (value) => {
return diagnostics.guard("main.control_62", async () => {
const diagnosticEnd61 = diagnostics?.start?.("control.create_missing_destinations.onChange") ?? (() => {});
try {
 this.plugin.settings.createMissing = value; await this.plugin.persist();
} catch (diagnosticError61) { diagnostics?.failure?.("control.create_missing_destinations.onChange", diagnosticError61); throw diagnosticError61; } finally { diagnosticEnd61(); }

});
}));
diagnosticStage42();

    const diagnosticStage43 = diagnostics?.start?.("settings.render.close_after_saving") ?? (() => {});
new Setting(containerEl).setName("Enter saves capture")
  .setDesc("On: Enter saves, Ctrl/Cmd+Enter adds a new line. Off: Enter adds a new line, Ctrl/Cmd+Enter saves. Shift+Enter always adds a new line.")
  .addToggle(toggle => toggle.setValue(this.plugin.settings.enterSaves !== false).onChange(value => diagnostics.guard("capture.enter-preference", async () => {
    const previous = this.plugin.settings.enterSaves !== false;
    this.plugin.settings.enterSaves = value;
    try { await this.plugin.persist(); }
    catch (error) {
      this.plugin.settings.enterSaves = previous;
      toggle.setValue(previous);
      new Notice("Could not save the keyboard preference. Try again.");
    }
  })));
new Setting(containerEl).setName("Close after saving").setDesc("Close the scratchpad after a successful save.").addToggle((toggle) => toggle.setValue(this.plugin.settings.closeAfterSaving).onChange(async (value) => {
return diagnostics.guard("main.control_63", async () => {
const diagnosticEnd62 = diagnostics?.start?.("control.close_after_saving.onChange") ?? (() => {});
try {
 this.plugin.settings.closeAfterSaving = value; await this.plugin.persist();
} catch (diagnosticError62) { diagnostics?.failure?.("control.close_after_saving.onChange", diagnosticError62); throw diagnosticError62; } finally { diagnosticEnd62(); }

});
}));
diagnosticStage43();

    const diagnosticStage44 = diagnostics?.start?.("settings.render.launch_at_login") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Launch at login").setDesc("Start Obsidian when you sign in to your computer. Off by default; available on supported desktop systems.").addToggle((toggle) => toggle.setValue(this.plugin.settings.launchAtLogin).onChange(async (value) => {
return diagnostics.guard("main.control_64", async () => {
const diagnosticEnd63 = diagnostics?.start?.("control.launch_at_login.onChange") ?? (() => {});
try {
 this.plugin.settings.launchAtLogin = value; this.plugin.applyLaunchAtLogin(); await this.plugin.persist();
} catch (diagnosticError63) { diagnostics?.failure?.("control.launch_at_login.onChange", diagnosticError63); throw diagnosticError63; } finally { diagnosticEnd63(); }

});
}));
diagnosticStage44();

    const diagnosticStage45 = diagnostics?.start?.("settings.render.queue") ?? (() => {});
new Setting(containerEl).setName("Queue").setDesc(`${this.plugin.queue.length} capture${this.plugin.queue.length === 1 ? "" : "s"} waiting for delivery.`).addButton((button) => button.setButtonText("Show queue").onClick(() => {
return diagnostics.guard("main.control_65", () => { const diagnosticAction64 = () => (new QueueModal(this.app, this.plugin).open()); return diagnostics?.run ? diagnostics.run("control.queue.onClick", diagnosticAction64) : diagnosticAction64();
});
})).addButton((button) => button.setButtonText("Flush now").onClick(() => {
return diagnostics.guard("main.control_66", () => { const diagnosticAction65 = () => (void diagnostics.guard("main.background_67", () => (this.plugin.flushQueue(true)))); return diagnostics?.run ? diagnostics.run("control.queue.onClick", diagnosticAction65) : diagnosticAction65();
});
}));
diagnosticStage45();

    const diagnosticStage46 = diagnostics?.start?.("settings.render.validate_destination") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Validate destination").setDesc("Check the configured destination without writing a test note.").addButton((button) => button.setButtonText("Validate").onClick(async () => {
return diagnostics.guard("main.control_68", async () => {
const diagnosticEnd66 = diagnostics?.start?.("control.validate_destination.onClick") ?? (() => {});
try {
 const result = await this.plugin.validateDestination(); new Notice(result.ok ? `Kairo: destination ready at ${result.path}.` : `Kairo: ${result.reason ?? "destination is not ready"}`);
} catch (diagnosticError66) { diagnostics?.failure?.("control.validate_destination.onClick", diagnosticError66); throw diagnosticError66; } finally { diagnosticEnd66(); }

});
}));
diagnosticStage46();

    const diagnosticStage47 = diagnostics?.start?.("settings.render.stage_6") ?? (() => {});
void diagnostics.guard("main.background_69", () => (syncPurchasedUses(this.plugin).then(() => this.renderUsageSummary()).catch((rejectedError7) => { diagnostics.failure("main.rejected_8", rejectedError7); return (new Notice("Kairo: could not refresh balance. Use Refresh to retry.")); })));
diagnosticStage47();


}; return diagnostics?.run ? diagnostics.run("settings.open", diagnosticAction20) : diagnosticAction20();

});
}

  private renderUsageSummary(): void {
const diagnosticAction67 = () => {

    if (!this.usageSummaryEl) return;
    normalizeBillingSettings(this.plugin.settings);
    const total = this.plugin.settings.freeUsesRemaining + this.plugin.settings.purchasedUses;
    const account = this.plugin.settings.billingAccountLinked ? "account linked" : "sign in required";
    this.usageSummaryEl.setText(!this.plugin.settings.billingAccountLinked || !this.plugin.settings.billingAccessToken ? "Create an account or sign in, then Connect to load your free and purchased credits." : `Uses remaining: ${total.toLocaleString()} (${this.plugin.settings.freeUsesRemaining} free + ${this.plugin.settings.purchasedUses.toLocaleString()} purchased; ${account})`);

}; return diagnostics?.run ? diagnostics.run("main.renderUsageSummary", diagnosticAction67) : diagnosticAction67();
}

  hide(): void { const end = diagnostics?.start?.("settings.close") ?? (() => {}); try { super.hide(); } finally { end(); } }
}
