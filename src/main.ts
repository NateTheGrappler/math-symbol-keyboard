import {
  App,
  Editor,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  setTooltip,
} from "obsidian";

const VIEW_TYPE_SYMBOLS = "symbol-picker-view";

// ---------- Data shapes (this is what lives in data.json) ----------
interface SymbolDef {
  ch: string;     // the character inserted
  name: string;   // hover title
  desc?: string;  // optional extra hover line
}

interface SymbolGroup {
  group: string;
  items: SymbolDef[];
}

interface SymbolPickerSettings {
  groups: SymbolGroup[];
}

// ---------- Defaults: only used the first time, or on "Reset to defaults" ----------
const DEFAULT_GROUPS: SymbolGroup[] = [
  {
    group: "Sets",
    items: [
      { ch: "∅", name: "Empty set", desc: "The set with no elements" },
      { ch: "∈", name: "Element of", desc: "x ∈ A: x is in set A" },
      { ch: "∉", name: "Not an element of" },
      { ch: "⊂", name: "Proper subset of" },
      { ch: "⊆", name: "Subset of or equal to" },
      { ch: "⊃", name: "Proper superset of" },
      { ch: "⊇", name: "Superset of or equal to" },
      { ch: "∪", name: "Union", desc: "Elements in A or B" },
      { ch: "∩", name: "Intersection", desc: "Elements in both A and B" },
      { ch: "∖", name: "Set difference", desc: "A ∖ B: in A but not in B" },
      { ch: "ℕ", name: "Natural numbers" },
      { ch: "ℤ", name: "Integers" },
      { ch: "ℚ", name: "Rational numbers" },
      { ch: "ℝ", name: "Real numbers" },
      { ch: "ℂ", name: "Complex numbers" },
    ],
  },
  {
    group: "Logic",
    items: [
      { ch: "¬", name: "Not (negation)" },
      { ch: "∧", name: "And (conjunction)" },
      { ch: "∨", name: "Or (disjunction)" },
      { ch: "→", name: "Implies (conditional)" },
      { ch: "↔", name: "If and only if (biconditional)" },
      { ch: "⇒", name: "Implies" },
      { ch: "⇔", name: "If and only if (equivalence)" },
      { ch: "∀", name: "For all" },
      { ch: "∃", name: "There exists" },
      { ch: "∄", name: "There does not exist" },
      { ch: "⊤", name: "True (top)" },
      { ch: "⊥", name: "False (bottom) / contradiction" },
      { ch: "⊕", name: "Exclusive or (XOR)" },
    ],
  },
  {
    group: "Relations",
    items: [
      { ch: "≠", name: "Not equal to" },
      { ch: "≈", name: "Approximately equal to" },
      { ch: "≡", name: "Identical to / congruent to" },
      { ch: "≤", name: "Less than or equal to" },
      { ch: "≥", name: "Greater than or equal to" },
      { ch: "≪", name: "Much less than" },
      { ch: "≫", name: "Much greater than" },
      { ch: "∝", name: "Proportional to" },
      { ch: "∼", name: "Similar to / distributed as", desc: "X ∼ N(0, 1)" },
    ],
  },
  {
    group: "Operators",
    items: [
      { ch: "±", name: "Plus or minus" },
      { ch: "×", name: "Multiplication / cross product" },
      { ch: "÷", name: "Division" },
      { ch: "·", name: "Dot product / multiplication" },
      { ch: "∘", name: "Function composition", desc: "(f ∘ g)(x) = f(g(x))" },
      { ch: "√", name: "Square root" },
      { ch: "∑", name: "Summation" },
      { ch: "∏", name: "Product" },
      { ch: "∫", name: "Integral" },
      { ch: "∂", name: "Partial derivative" },
      { ch: "∇", name: "Nabla (gradient)" },
      { ch: "∞", name: "Infinity" },
    ],
  },
  {
    group: "Greek",
    items: [
      { ch: "α", name: "alpha" },
      { ch: "β", name: "beta" },
      { ch: "γ", name: "gamma" },
      { ch: "δ", name: "delta" },
      { ch: "ε", name: "epsilon" },
      { ch: "θ", name: "theta" },
      { ch: "λ", name: "lambda" },
      { ch: "μ", name: "mu", desc: "Often the mean" },
      { ch: "π", name: "pi" },
      { ch: "σ", name: "sigma", desc: "Often standard deviation" },
      { ch: "φ", name: "phi" },
      { ch: "ω", name: "omega" },
      { ch: "Δ", name: "Delta (capital)", desc: "Change in a quantity" },
      { ch: "Σ", name: "Sigma (capital)" },
      { ch: "Ω", name: "Omega (capital)" },
    ],
  },
  {
    group: "Arrows",
    items: [
      { ch: "←", name: "Left arrow" },
      { ch: "↑", name: "Up arrow" },
      { ch: "↓", name: "Down arrow" },
      { ch: "↦", name: "Maps to", desc: "x ↦ x²" },
      { ch: "⟶", name: "Long right arrow" },
      { ch: "⟹", name: "Long implies" },
    ],
  },
];

function cloneDefaults(): SymbolGroup[] {
  return JSON.parse(JSON.stringify(DEFAULT_GROUPS)) as SymbolGroup[];
}

// ---------- Validation (no `any`, so lint stays clean) ----------
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSymbol(value: unknown): value is SymbolDef {
  return (
    isRecord(value) &&
    typeof value.ch === "string" &&
    typeof value.name === "string" &&
    (value.desc === undefined || typeof value.desc === "string")
  );
}

function isValidGroups(value: unknown): value is SymbolGroup[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every(
      (g) =>
        isRecord(g) &&
        typeof g.group === "string" &&
        Array.isArray(g.items) &&
        (g.items as unknown[]).every(isValidSymbol)
    )
  );
}

// ---------- Rendering the buttons (shared by sidebar + popup) ----------
function buildSymbolGrid(
  container: HTMLElement,
  groups: SymbolGroup[],
  onPick: (ch: string) => void
) {
  for (const { group, items } of groups) {
    const usable = items.filter((s) => s.ch.length > 0);
    if (usable.length === 0) continue;

    container.createEl("h4", { text: group, cls: "symbol-picker-heading" });
    const grid = container.createDiv({ cls: "symbol-picker-grid" });

    for (const { ch, name, desc } of usable) {
      const btn = grid.createEl("button", { text: ch, cls: "symbol-picker-btn" });
      const tip = name || ch;
      setTooltip(btn, desc ? `${tip}\n${desc}` : tip, { placement: "top" });
      btn.addEventListener("click", () => onPick(ch));
    }
  }
}

// ---------- Small confirmation dialog (window.confirm is unreliable on mobile) ----------
class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Are you sure?");
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Confirm").setWarning().onClick(() => {
          this.close();
          this.onConfirm();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------- Right-hand sidebar panel ----------
class SymbolSidebarView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: SymbolPickerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_SYMBOLS;
  }

  getDisplayText() {
    return "Symbols";
  }

  getIcon() {
    return "sigma";
  }

  async onOpen() {
    this.render();
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("symbol-picker-sidebar");

    const groups = this.plugin.settings.groups;
    if (!groups.some((g) => g.items.some((s) => s.ch))) {
      container.createEl("p", {
        text: "No symbols yet. Add some in this plugin's settings.",
        cls: "symbol-picker-empty",
      });
      return;
    }

    buildSymbolGrid(container, groups, (ch) => this.plugin.insertIntoLastEditor(ch));
  }

  async onClose() {
    this.contentEl.empty();
  }
}

// ---------- Optional popup version ----------
class SymbolPickerModal extends Modal {
  constructor(app: App, private editor: Editor, private groups: SymbolGroup[]) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Insert symbol");
    buildSymbolGrid(this.contentEl, this.groups, (ch) => {
      this.editor.replaceSelection(ch);
      this.close();
      this.editor.focus();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------- Settings page ----------
class SymbolPickerSettingTab extends PluginSettingTab {
  // Remember which groups are expanded so re-rendering doesn't collapse them.
  private openGroups = new Set<number>();

  constructor(app: App, private plugin: SymbolPickerPlugin) {
    super(app, plugin);
  }

  private save() {
    void this.plugin.saveSettings();
  }

  private saveAndRedraw() {
    void this.plugin.saveSettings().then(() => this.display());
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const groups = this.plugin.settings.groups;

    new Setting(containerEl).setName("Symbol groups").setHeading();

    groups.forEach((group, gi) => {
      const details = containerEl.createEl("details", { cls: "symbol-picker-settings-group" });
      details.open = this.openGroups.has(gi);
      details.addEventListener("toggle", () => {
        if (details.open) this.openGroups.add(gi);
        else this.openGroups.delete(gi);
      });

      const summary = details.createEl("summary");
      const updateSummary = () =>
        summary.setText(`${group.group || "(unnamed group)"}  ·  ${group.items.length} symbols`);
      updateSummary();

      // Group name, reorder, delete
      new Setting(details)
        .setClass("symbol-picker-group-row")
        .addText((t) => {
          t.setPlaceholder("Group name")
            .setValue(group.group)
            .onChange((v) => {
              group.group = v;
              updateSummary();
              this.save();
            });
          t.inputEl.addClass("symbol-picker-group-input");
        })
        .addExtraButton((b) =>
          b.setIcon("arrow-up").setTooltip("Move group up").setDisabled(gi === 0)
            .onClick(() => this.moveGroup(gi, -1))
        )
        .addExtraButton((b) =>
          b.setIcon("arrow-down").setTooltip("Move group down").setDisabled(gi === groups.length - 1)
            .onClick(() => this.moveGroup(gi, 1))
        )
        .addButton((b) =>
          b.setButtonText("Delete group").setWarning().onClick(() => {
            new ConfirmModal(
              this.app,
              `Delete the group "${group.group}" and all its symbols?`,
              () => {
                groups.splice(gi, 1);
                this.openGroups.clear();
                this.saveAndRedraw();
              }
            ).open();
          })
        );

      // One row per symbol: character | name | description | delete
      group.items.forEach((item, ii) => {
        new Setting(details)
          .setClass("symbol-picker-settings-row")
          .addText((t) => {
            t.setPlaceholder("∈").setValue(item.ch).onChange((v) => {
              item.ch = v.trim();
              this.save();
            });
            t.inputEl.addClass("symbol-picker-ch-input");
          })
          .addText((t) => {
            t.setPlaceholder("Name (hover title)").setValue(item.name).onChange((v) => {
              item.name = v;
              this.save();
            });
            t.inputEl.addClass("symbol-picker-name-input");
          })
          .addText((t) => {
            t.setPlaceholder("Description (optional)").setValue(item.desc ?? "").onChange((v) => {
              item.desc = v || undefined;
              this.save();
            });
            t.inputEl.addClass("symbol-picker-desc-input");
          })
          .addExtraButton((b) =>
            b.setIcon("trash").setTooltip("Delete symbol").onClick(() => {
              group.items.splice(ii, 1);
              this.saveAndRedraw();
            })
          );
      });

      new Setting(details).addButton((b) =>
        b.setButtonText("Add symbol").onClick(() => {
          group.items.push({ ch: "", name: "" });
          this.openGroups.add(gi);
          this.saveAndRedraw();
        })
      );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Add group").setCta().onClick(() => {
        groups.push({ group: "New group", items: [] });
        this.openGroups.add(groups.length - 1);
        this.saveAndRedraw();
      })
    );

    // ---------- Raw JSON editor ----------
    new Setting(containerEl)
      .setName("Edit as JSON")
      .setDesc("Paste or edit the whole symbol list at once. Handy for sharing your set or bulk edits.")
      .setHeading();

    const textarea = containerEl.createEl("textarea", { cls: "symbol-picker-json" });
    textarea.value = JSON.stringify(groups, null, 2);
    textarea.spellcheck = false;

    new Setting(containerEl)
      .addButton((b) =>
        b.setButtonText("Save JSON").setCta().onClick(() => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(textarea.value);
          } catch (e) {
            new Notice(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
          if (!isValidGroups(parsed)) {
            new Notice('JSON must be a list of { "group": "...", "items": [{ "ch": "...", "name": "..." }] }');
            return;
          }
          this.plugin.settings.groups = parsed;
          this.openGroups.clear();
          new Notice("Symbols saved.");
          this.saveAndRedraw();
        })
      )
      .addButton((b) =>
        b.setButtonText("Copy JSON").onClick(() => {
          void navigator.clipboard.writeText(textarea.value).then(() => new Notice("Copied to clipboard."));
        })
      )
      .addButton((b) =>
        b.setButtonText("Reset to defaults").setWarning().onClick(() => {
          new ConfirmModal(
            this.app,
            "Replace all your symbols with the built-in defaults?",
            () => {
              this.plugin.settings.groups = cloneDefaults();
              this.openGroups.clear();
              this.saveAndRedraw();
            }
          ).open();
        })
      );
  }

  private moveGroup(index: number, delta: number) {
    const groups = this.plugin.settings.groups;
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    [groups[index], groups[target]] = [groups[target], groups[index]];
    this.openGroups.clear();
    this.saveAndRedraw();
  }
}

// ---------- Plugin ----------
export default class SymbolPickerPlugin extends Plugin {
  settings: SymbolPickerSettings = { groups: [] };
  private lastMarkdownView: MarkdownView | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_SYMBOLS, (leaf) => new SymbolSidebarView(leaf, this));
    this.addSettingTab(new SymbolPickerSettingTab(this.app, this));

    this.lastMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMarkdownView = leaf.view;
      })
    );

    // No default hotkeys: Obsidian's guidelines ask plugins to let users bind their own.
    this.addCommand({
      id: "toggle-symbol-sidebar",
      name: "Toggle symbol sidebar",
      callback: () => void this.toggleSidebar(),
    });

    this.addCommand({
      id: "open-symbol-picker",
      name: "Open symbol picker (popup)",
      editorCallback: (editor: Editor) =>
        new SymbolPickerModal(this.app, editor, this.settings.groups).open(),
    });

    this.addRibbonIcon("sigma", "Toggle symbol sidebar", () => void this.toggleSidebar());
  }

  // Reads data.json. First run (no file yet, or a broken one) falls back to the defaults.
  async loadSettings() {
    const data: unknown = await this.loadData();
    const groups = isRecord(data) ? data.groups : undefined;
    this.settings = { groups: isValidGroups(groups) ? groups : cloneDefaults() };
  }

  // Writes data.json and redraws any open sidebar so changes show immediately.
  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }

  // Called by Obsidian if data.json changes on disk (e.g. edited by hand or synced).
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.refreshViews();
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SYMBOLS)) {
      if (leaf.view instanceof SymbolSidebarView) leaf.view.render();
    }
  }

  async toggleSidebar() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_SYMBOLS);

    if (existing.length > 0) {
      existing.forEach((leaf) => leaf.detach());
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_SYMBOLS, active: true });
    await workspace.revealLeaf(leaf);
  }

  insertIntoLastEditor(ch: string) {
    const view = this.lastMarkdownView;
    // The remembered note may have been closed since; make sure it's still open.
    const stillOpen =
      view !== null && this.app.workspace.getLeavesOfType("markdown").includes(view.leaf);

    if (!view || !stillOpen || !view.file) {
      this.lastMarkdownView = null;
      new Notice("Click into a note first.");
      return;
    }
    if (view.getMode() !== "source") {
      new Notice("Switch the note to editing mode to insert symbols.");
      return;
    }

    view.editor.replaceSelection(ch);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
  }
}