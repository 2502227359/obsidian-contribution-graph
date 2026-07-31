import { App, FuzzySuggestModal, TFolder } from "obsidian";

export function getSelectableVaultFolders(
	app: App,
	selectedFolders: readonly string[] = []
): TFolder[] {
	return app.vault
		.getAllLoadedFiles()
		.filter(
			(file): file is TFolder =>
				file instanceof TFolder &&
				file.path.length > 0 &&
				!selectedFolders.some(
					(folder) =>
						file.path === folder ||
						file.path.startsWith(`${folder}/`)
				)
		)
		.sort((a, b) => a.path.localeCompare(b.path));
}

export class VaultFolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly folders: TFolder[],
		placeholder: string,
		private readonly choose: (folder: TFolder) => void
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.choose(folder);
	}
}
