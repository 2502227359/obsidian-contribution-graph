import { App, FuzzySuggestModal, TFile } from "obsidian";

export function getSelectableVaultNotes(
	app: App,
	selectedFiles: readonly string[] = []
): TFile[] {
	const selected = new Set(selectedFiles.map((path) => path.replace(/\\/g, "/")));
	return app.vault
		.getAllLoadedFiles()
		.filter(
			(file): file is TFile =>
				file instanceof TFile &&
				file.extension.toLowerCase() === "md" &&
				!selected.has(file.path.replace(/\\/g, "/"))
		)
		.sort((a, b) => a.path.localeCompare(b.path));
}

export class VaultNoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly files: TFile[],
		placeholder: string,
		private readonly choose: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.choose(file);
	}
}
