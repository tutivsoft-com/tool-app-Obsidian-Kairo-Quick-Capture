/** Presentation only: preserve Setting instances, callbacks and live status elements. */
const keySettings: Record<string, string[]> = {
  "culebra-ai-spell-correct": ["Review before applying"],
  "denali-ai-file-renamer-front-matter": ["Rename new notes automatically", "Review before applying"],
  "garda-handwriting-text-ocr": ["AI connection"],
  "torbert-text-ai-obsidian": ["Review before applying", "AI classification folders", "Custom prompt presets", "OpenRouter API key"],
  "kairo-quick-capture": ["Destination mode", "Automatic delivery"],
  "cairn-vault-linter": ["Review repairs before applying", "Ignored folders"],
  "tundra-frontmatter-wrangler": ["Existing AI properties", "Review before applying"],
  "meridian-timeline": ["Date properties"],
  "aegis-note-locker": ["Session password", "Session timeout"],
  "mica-webp-optimizer": ["Automatic optimization", "After conversion", "Watched folders"],
};
const appTitles: Record<string, string> = {
  "kairo-quick-capture": "Kairo Quick Capture",
  "culebra-ai-spell-correct": "Culebra AI Spell Correct",
};

function label(node: Element): string {
  return (node.querySelector(".setting-item-name")?.textContent || node.textContent || "").trim();
}

function makeSection(root: HTMLElement, title: string, kind = "everyday"): HTMLElement {
  const section = root.createEl("section", { cls: `ui-settings-section ui-section-${kind}` });
  section.createEl("h3", { text: title, cls: "ui-section-heading" });
  return section.createDiv({ cls: "ui-settings-card" });
}

export function applySettingsLayout(root: HTMLElement, appId: string): void {
  if (root.querySelector(":scope > .ui-settings-section")) return;
  root.addClass("ui-settings-layout");
  const nodes = Array.from(root.children) as HTMLElement[];
  const account = nodes.find(node => node.classList.contains("constance-account-billing-section"));
  let accountCard: HTMLElement | undefined;
  if (account) {
    account.addClass("ui-settings-section", "ui-section-billing");
    const heading = account.querySelector(":scope > h3") as HTMLElement | null;
    heading?.addClass("ui-section-heading");
    const content = Array.from(account.children).filter(node => node !== heading);
    accountCard = account.createDiv({ cls: "ui-settings-card" });
    content.forEach(node => accountCard!.appendChild(node));
    accountCard.querySelectorAll("button").forEach(button => {
      if (button.textContent?.trim() === "Connect") button.addClass("mod-cta");
    });
  }
  const title = nodes.find(node => /^H[12]$/.test(node.tagName)) ||
    (appTitles[appId] ? root.createEl("h2", { text: appTitles[appId] }) : undefined);
  if (title) { title.addClass("ui-settings-title"); root.prepend(title); }
  if (account) { if (title) title.after(account); else root.prepend(account); }

  let current: HTMLElement | undefined;
  let support: HTMLElement | undefined;
  let viewSection: HTMLElement | undefined;
  let billingContext = false;
  const supportLabels = new Set(["Help", "Debug logging", "Enable debug logging", "Diagnostics"]);
  const billingLabels = /^(?:Billing(?: & usage)?|Credits|Credit balance|OCR credits|Purchased balance|Refresh (?:purchased )?balance|Refresh account|Buy .+|Account)$/i;
  for (const node of nodes) {
    if (node === account || node === title) continue;
    const name = label(node);
    if (node.classList.contains("setting-item") && supportLabels.has(name)) {
      support ||= makeSection(root, "Help and diagnostics", "support");
      support.appendChild(node); continue;
    }
    if (node.classList.contains("setting-item") && /^Settings (?:mode|view)$/i.test(name)) {
      const view = makeSection(root, "Settings view"); view.appendChild(node); viewSection = view.parentElement!; continue;
    }
    const isHeading = /^H[1-4]$/.test(node.tagName) || node.classList.contains("setting-item-heading");
    if (isHeading) {
      billingContext = /^Billing(?: & usage)?$/i.test(name);
      if (billingContext) { node.remove(); continue; }
      const kind = /recovery|privacy|diagnostic/i.test(name) ? "support" : /AI|quality|naming|capture|date|original files/i.test(name) ? "feature" : "everyday";
      current = makeSection(root, name, kind); node.remove(); continue;
    }
    if (accountCard && (node.classList.contains("ui-billing-packs") ||
      node.classList.contains("ui-billing-summary") ||
      (node.classList.contains("setting-item") && billingLabels.test(name)) ||
      (billingContext && node.tagName === "P"))) {
      accountCard.appendChild(node);
      if (node.tagName === "P") node.addClass("ui-billing-summary");
      continue;
    }
    billingContext = false;
    current ||= makeSection(root, "Everyday settings");
    current.appendChild(node);
    if (node.tagName === "P") node.addClass("ui-section-note");
  }
  // Support is deliberately last; it must not compete with setup or everyday controls.
  if (viewSection) { if (account) account.after(viewSection); else if (title) title.after(viewSection); else root.prepend(viewSection); }
  if (support) root.appendChild(support.parentElement!);
  for (const card of Array.from(root.querySelectorAll(".ui-settings-card"))) {
    if (!card.children.length) card.parentElement?.remove();
  }
  const rows = Array.from(root.querySelectorAll(".ui-settings-card .setting-item"))
    .filter(node => !node.closest(".ui-section-billing, .ui-section-support") && !/^Settings (mode|view)$/i.test(label(node)));
  const limit = Math.max(1, Math.ceil(rows.length * 0.1));
  let marked = 0;
  for (const name of keySettings[appId] || []) {
    const row = rows.find(node => label(node) === name);
    if (!row || marked >= limit) continue;
    row.classList.add("ui-key-setting");
    const badge = document.createElement("span");
    badge.className = "ui-key-badge"; badge.textContent = "Important";
    row.querySelector(".setting-item-name")?.appendChild(badge);
    marked++;
  }
}
