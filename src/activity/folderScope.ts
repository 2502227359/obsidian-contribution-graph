export function normalizeTrackedFolderPath(path: string): string {
	const normalized = path
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+|\/+$/g, "");
	return normalized === "." ? "" : normalized;
}

export function normalizeTrackedFolders(paths: readonly string[]): string[] {
	const candidates = Array.from(
		new Set(paths.map(normalizeTrackedFolderPath).filter(Boolean))
	).sort((a, b) => {
		const depthDifference = a.split("/").length - b.split("/").length;
		return depthDifference !== 0
			? depthDifference
			: a.localeCompare(b);
	});

	const result: string[] = [];
	for (const folder of candidates) {
		if (
			result.some(
				(parent) =>
					folder === parent || folder.startsWith(`${parent}/`)
			)
		) {
			continue;
		}
		result.push(folder);
	}
	return result;
}

export function isFileInTrackedFolders(
	filePath: string,
	trackedFolders: readonly string[]
): boolean {
	if (trackedFolders.length === 0) {
		return true;
	}
	const normalizedFilePath = filePath.replace(/\\/g, "/");
	return trackedFolders.some((folder) =>
		normalizedFilePath.startsWith(`${folder}/`)
	);
}

/** Whether every requested graph folder is covered by the collection scope. */
export function areFoldersCoveredByScope(
	requestedFolders: readonly string[],
	collectionFolders: readonly string[]
): boolean {
	const requested = normalizeTrackedFolders(requestedFolders);
	const collected = normalizeTrackedFolders(collectionFolders);
	// An empty graph filter means "all activity that was collected", not a
	// request for every folder in the vault.
	if (requested.length === 0) {
		return true;
	}
	if (collected.length === 0) {
		return true;
	}
	return requested.every((folder) =>
		collected.some(
			(parent) =>
				folder === parent || folder.startsWith(`${parent}/`)
		)
	);
}

export function migrateTrackedFolderPaths(
	trackedFolders: readonly string[],
	oldPath: string,
	newPath: string
): string[] {
	const normalizedOldPath = normalizeTrackedFolderPath(oldPath);
	const normalizedNewPath = normalizeTrackedFolderPath(newPath);
	if (!normalizedOldPath || !normalizedNewPath) {
		return normalizeTrackedFolders(trackedFolders);
	}
	const oldPrefix = `${normalizedOldPath}/`;
	const newPrefix = `${normalizedNewPath}/`;
	return normalizeTrackedFolders(
		trackedFolders.map((folder) => {
			if (folder === normalizedOldPath) {
				return normalizedNewPath;
			}
			return folder.startsWith(oldPrefix)
				? `${newPrefix}${folder.slice(oldPrefix.length)}`
				: folder;
		})
	);
}
