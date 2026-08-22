import { App, PluginSettingTab } from "obsidian";
import type { Setting, SettingGroup } from "obsidian";
import ZoxidianPlugin from "./main";
import { applyAging } from "./frecency";
import { appendFileIcon } from "./utils";

export interface ZoxidianSettings {
	maxItems: number;
	excludePaths: string;
	openInNewTab: boolean;
	showFrecencyBadge: boolean;
	showScoreBadge: boolean;
	maxAge: number;
	recordOnEveryVisit: boolean;
	includeUntrackedInModal: boolean;
}

export const DEFAULT_SETTINGS: ZoxidianSettings = {
	maxItems: 50,
	excludePaths: "",
	openInNewTab: false,
	showFrecencyBadge: true,
	showScoreBadge: true,
	maxAge: 9000,
	recordOnEveryVisit: false,
	includeUntrackedInModal: true,
};

export class ZoxidianSettingTab extends PluginSettingTab {
	plugin: ZoxidianPlugin;

	constructor(app: App, plugin: ZoxidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Controls bind to this.plugin.settings[key], but persistence must go
	// through the plugin's combined { files, settings } blob — the default
	// setControlValue would saveData(settings) alone and drop tracked files.
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ZoxidianSettings];
	}

	setControlValue(key: string, value: unknown): void {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		s[key] = value;

		switch (key) {
			case "maxItems":
			case "excludePaths":
			case "showFrecencyBadge":
			case "showScoreBadge":
				this.plugin.redrawViews();
				break;
			case "maxAge":
				if (typeof value === "number" && value > 0) {
					applyAging(this.plugin.files, value);
				}
				this.plugin.redrawViews();
				break;
		}

		void this.plugin.persistData();
		// Re-render render()-driven rows (preview, stats) that depend on the
		// value just changed.
		this.update();
	}

	getSettingDefinitions() {
		return [
			{
				name: "About",
				desc: "Tracks note visits using the zoxide frecency algorithm. Each visit increments the base score; the displayed frecency score is weighted by recency.",
			},
			{
				type: "group" as const,
				heading: "General",
				items: [
					{
						name: "Max items",
						desc: "Maximum number of notes to show in the panel.",
						control: {
							type: "number" as const,
							key: "maxItems",
							placeholder: "50",
							min: 1,
							step: 1,
							validate: (v: number) =>
								Number.isInteger(v) && v >= 1 ? undefined : "Enter a whole number of 1 or more.",
						},
					},
					{
						name: "Exclude paths (regex)",
						desc: "Notes whose path matches this regex are excluded. Example: ^daily/",
						control: {
							type: "text" as const,
							key: "excludePaths",
							placeholder: "^daily/",
							validate: (v: string) => {
								try {
									new RegExp(v);
									return undefined;
								} catch {
									return "Invalid regular expression.";
								}
							},
						},
					},
					{
						name: "Open in new tab by default",
						desc: "When enabled, clicking a note opens it in a new tab. You can always Ctrl/Cmd+click to toggle.",
						control: { type: "toggle" as const, key: "openInNewTab" },
					},
					{
						name: "Record score on every visit",
						desc: "Off (default): score increments only when you open a note that has no existing tab. " +
							"Switching focus to an already-open tab does not count, but closing and reopening does. " +
							"On: score increments every time the note becomes active, including tab switches.",
						control: { type: "toggle" as const, key: "recordOnEveryVisit" },
					},
					{
						name: "Include untracked files in search modal",
						desc: "When enabled, the search modal lists all vault notes after tracked ones. " +
							"Tracked notes (sorted by frecency) always appear first.",
						control: { type: "toggle" as const, key: "includeUntrackedInModal" },
					},
				],
			},
			{
				type: "group" as const,
				heading: "Display",
				items: [
					{
						name: "Show frecency badge",
						desc: "Display the frecency score badge (accent colour) next to each note.",
						control: { type: "toggle" as const, key: "showFrecencyBadge" },
					},
					{
						name: "Show score badge",
						desc: "Display the score badge (muted) next to each note.",
						control: { type: "toggle" as const, key: "showScoreBadge" },
					},
					{
						name: "Preview",
						desc: "How a note row looks with your current badge settings.",
						render: (_setting: Setting, group: SettingGroup) => {
							group.addSetting((setting) => {
								setting.setName("Example");
								const row = setting.infoEl.createDiv({ cls: "zoxidian-preview-wrap" });
								this.renderExampleRow(row);
							});
						},
					},
				],
			},
			{
				type: "group" as const,
				heading: "Aging",
				items: [
					{
						name: "Max age",
						desc: "Maximum total score across all notes (zoxide default: 9000). " +
							"When the sum of all base scores exceeds this, every score is scaled down proportionally " +
							"and notes that fall below 1 are pruned immediately.",
						control: {
							type: "number" as const,
							key: "maxAge",
							placeholder: "9000",
							min: 1,
							step: 1,
							validate: (v: number) =>
								Number.isInteger(v) && v >= 1 ? undefined : "Enter a whole number of 1 or more.",
						},
					},
					{
						name: "Usage",
						render: (_setting: Setting, group: SettingGroup) => {
							group.addSetting((setting) => {
								setting.setName("Score pool");
								this.renderStats(setting.infoEl);
							});
						},
					},
				],
			},
			{
				type: "group" as const,
				heading: "How it works",
				items: [
					{
						name: "Algorithm",
						render: (_setting: Setting, group: SettingGroup) => {
							group.addSetting((setting) => {
								setting.setName("Frecency scoring");
								this.renderAlgoExplainer(setting.infoEl);
							});
						},
					},
				],
			},
			{
				name: "Clear all data",
				desc: "Remove all tracked visit data. This cannot be undone.",
				action: () => {
					this.plugin.clearData();
					this.plugin.redrawViews();
					this.update();
				},
			},
		];
	}

	private renderExampleRow(root: HTMLElement): void {
		root.empty();

		const row = root.createDiv({ cls: "zoxidian-item" });

		row.createSpan({ cls: "zoxidian-item-icon" }, (span) => appendFileIcon(span));

		row.createSpan({
			cls: "zoxidian-item-name",
			text: "Example note",
		});

		const badges = row.createDiv({ cls: "zoxidian-badges" });

		if (this.plugin.settings.showFrecencyBadge) {
			badges.createSpan({
				cls: "zoxidian-badge zoxidian-badge-frecency",
				text: "8.0",
			});
		}

		if (this.plugin.settings.showScoreBadge) {
			badges.createSpan({
				cls: "zoxidian-badge zoxidian-badge-base",
				text: "4",
			});
		}
	}

	private renderStats(root: HTMLElement): void {
		root.empty();
		root.addClass("zoxidian-stats");

		const total = this.plugin.getTotalScore();
		const count = Object.keys(this.plugin.files).length;
		const pct = Math.min(100, (total / this.plugin.settings.maxAge) * 100);

		const grid = root.createDiv({ cls: "zoxidian-stats-grid" });

		const addStat = (label: string, value: string) => {
			const cell = grid.createDiv({ cls: "zoxidian-stat" });
			cell.createSpan({ cls: "zoxidian-stat-value", text: value });
			cell.createSpan({ cls: "zoxidian-stat-label", text: label });
		};

		addStat("Tracked notes", String(count));
		addStat("Total score", `${total.toFixed(1)} / ${this.plugin.settings.maxAge}`);
		addStat("Age pool used", `${pct.toFixed(1)}%`);

		// Progress bar
		const barWrap = root.createDiv({ cls: "zoxidian-age-bar-wrap" });
		const bar = barWrap.createDiv({ cls: "zoxidian-age-bar" });
		bar.setCssProps({ "--zoxidian-age-pct": `${pct}%` });
	}

	private renderAlgoExplainer(root: HTMLElement): void {
		root.empty();
		root.addClass("zoxidian-algo");

		const steps: Array<[string, string]> = [
			[
				"1 · Base score",
				"Every time you open a note its base score increases by 1. " +
				"A note opened 20 times has a base score of 20.",
			],
			[
				"2 · Frecency",
				"When notes are ranked for display, the base score is multiplied by a recency factor " +
				"so freshly-visited notes surface even if they have a low total count:",
			],
			[
				"3 · Aging",
				"When the sum of all base scores exceeds Max age, every score is scaled down " +
				"proportionally so the total becomes 90% of Max age. " +
				"Notes whose score falls below 1 are pruned. " +
				"This bounds score growth and lets rarely-visited notes fade naturally.",
			],
		];

		for (const [heading, body] of steps) {
			const block = root.createDiv({ cls: "zoxidian-algo-step" });
			block.createEl("p", { cls: "zoxidian-algo-heading", text: heading });
			block.createEl("p", { cls: "zoxidian-algo-body", text: body });
		}

		const tableBlock = root.createDiv({ cls: "zoxidian-algo-step" });
		tableBlock.createEl("p", { cls: "zoxidian-algo-heading", text: "" });

		const table = tableBlock.createEl("table", { cls: "zoxidian-algo-table" });
		const thead = table.createEl("thead");
		const hrow = thead.createEl("tr");
		hrow.createEl("th", { text: "Last opened" });
		hrow.createEl("th", { text: "Multiplier" });

		const rows: Array<[string, string]> = [
			["Within the last hour", "× 4"],
			["Within the last day", "× 2"],
			["Within the last week", "÷ 2"],
			["Longer ago", "÷ 4"],
		];
		const tbody = table.createEl("tbody");
		for (const [when, mult] of rows) {
			const tr = tbody.createEl("tr");
			tr.createEl("td", { text: when });
			tr.createEl("td", { cls: "zoxidian-algo-mult", text: mult });
		}
	}
}
