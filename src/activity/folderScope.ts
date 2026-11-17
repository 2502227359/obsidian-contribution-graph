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

export function normalizeTrackedFiles(paths: readonly string[]): string[] {
	return Array.from(new Set(paths.map(normalizeTrackedFilePath).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizeTrackedFilePath(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
	const parts = normalized.split("/");
	if (!normalized || normalized === "." || parts.some(part => part === "." || part === "..") || /^[A-Za-z]:/.test(normalized) || !/\.md$/i.test(normalized)) return "";
	return normalized;
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

export function isFileInCollectionScope(
	filePath: string,
	trackedFolders: readonly string[],
	trackedFiles: readonly string[] = []
): boolean {
	const folders = normalizeTrackedFolders(trackedFolders);
	const files = normalizeTrackedFiles(trackedFiles);
	const normalizedPath = filePath.replace(/\\/g, "/");
	if (folders.length === 0 && files.length === 0) return true;
	return files.includes(normalizedPath) || (folders.length > 0 && isFileInTrackedFolders(normalizedPath, folders));
}

/** Whether every requested graph folder is covered by the collection scope. */
export function areFoldersCoveredByScope(
	requestedFolders: readonly string[],
	collectionFolders: readonly string[],
	collectionFiles: readonly string[] = []
): boolean {
	const requested = normalizeTrackedFolders(requestedFolders);
	const collected = normalizeTrackedFolders(collectionFolders);
	// An empty graph filter means "all activity that was collected", not a
	// request for every folder in the vault.
	if (requested.length === 0) {
		return true;
	}
	if (collected.length === 0 && collectionFiles.length === 0) {
		return true;
	}
	return requested.every((folder) =>
		collected.some(
			(parent) =>
				folder === parent || folder.startsWith(`${parent}/`)
		)
	);
}

export function migrateTrackedFilePaths(
	trackedFiles: readonly string[],
	oldPath: string,
	newPath: string,
	isFolder: boolean
): string[] {
	const normalizedFiles = normalizeTrackedFiles(trackedFiles);
	const normalizedOldPath = normalizeTrackedPath(oldPath);
	const normalizedNewPath = normalizeTrackedPath(newPath);
	if (!normalizedOldPath || !normalizedNewPath || (!isFolder && !normalizeTrackedFilePath(normalizedNewPath))) return normalizedFiles;
	const oldPrefix = `${normalizedOldPath}/`;
	return normalizeTrackedFiles(normalizedFiles.map(file => {
		if (!isFolder) return file === normalizedOldPath ? normalizedNewPath : file;
		return file.startsWith(oldPrefix) ? `${normalizedNewPath}/${file.slice(oldPrefix.length)}` : file;
	}));
}

function normalizeTrackedPath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
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
