import { describe, expect, it } from "vitest";
import {
	areFoldersCoveredByScope,
	isFileInCollectionScope,
	isFileInTrackedFolders,
	migrateTrackedFilePaths,
	migrateTrackedFolderPaths,
	normalizeTrackedFolderPath,
	normalizeTrackedFiles,
	normalizeTrackedFolders,
} from "../src/activity/folderScope";

describe("edit activity folder scope", () => {
	it("normalizes separators and surrounding slashes", () => {
		expect(normalizeTrackedFolderPath(" /Projects\\Writing/ ")).toBe(
			"Projects/Writing"
		);
	});

	it("removes duplicates and folders already covered by a parent", () => {
		expect(
			normalizeTrackedFolders([
				"Projects/Writing",
				"Projects",
				"Daily Notes/",
				"Projects",
			])
		).toEqual(["Daily Notes", "Projects"]);
	});

	it("tracks the whole vault when no folders are configured", () => {
		expect(isFileInTrackedFolders("Any/Note.md", [])).toBe(true);
	});

	it("matches folder boundaries instead of path prefixes", () => {
		expect(
			isFileInTrackedFolders("Projects/Writing/Note.md", [
				"Projects",
			])
		).toBe(true);
		expect(
			isFileInTrackedFolders("Projects-old/Note.md", ["Projects"])
		).toBe(false);
		expect(
			isFileInTrackedFolders("Daily Notes/Today.md", ["Projects"])
		).toBe(false);
	});

	it("migrates configured folders when a parent folder is renamed", () => {
		expect(
			migrateTrackedFolderPaths(
				["Projects/Writing", "Daily Notes"],
				"Projects",
				"Archive"
			)
		).toEqual(["Daily Notes", "Archive/Writing"]);
	});

	it("checks graph folders against parent collection scopes", () => {
		expect(areFoldersCoveredByScope(["Projects/Writing"], ["Projects"])).toBe(true);
		expect(areFoldersCoveredByScope(["Journal"], ["Projects"])).toBe(false);
		expect(areFoldersCoveredByScope(["Anywhere"], [])).toBe(true);
		expect(areFoldersCoveredByScope([], ["Projects"])).toBe(true);
	});

	it("normalizes explicit markdown files and matches the directory/file union", () => {
		expect(normalizeTrackedFiles([
			" /Root\\A.md ", "Root/A.md", "Root/B.txt", "Root/../C.md", ".",
		])).toEqual(["Root/A.md"]);
		expect(isFileInCollectionScope("Root/A.md", [], ["Root/A.md"])).toBe(true);
		expect(isFileInCollectionScope("Root/B.md", ["Root"], [])).toBe(true);
		expect(isFileInCollectionScope("Root/B.md", [], ["Root/A.md"])).toBe(false);
		expect(isFileInCollectionScope("Other/C.md", ["Root"], ["Other/C.md"])).toBe(true);
		expect(isFileInCollectionScope("Other/D.md", [], [])).toBe(true);
	});

	it("does not treat one selected note as coverage of its parent folder", () => {
		expect(areFoldersCoveredByScope(["Root"], [], ["Root/A.md"])).toBe(false);
		expect(areFoldersCoveredByScope(["Root/Sub"], ["Root"], ["Root/A.md"])).toBe(true);
		expect(areFoldersCoveredByScope([], [], ["Root/A.md"])).toBe(true);
	});

	it("migrates exact selected notes and notes below a renamed folder", () => {
		expect(migrateTrackedFilePaths(["Root/A.md", "Root-old/B.md", "Other/C.md"], "Root", "Archive", true))
			.toEqual(["Archive/A.md", "Other/C.md", "Root-old/B.md"]);
		expect(migrateTrackedFilePaths(["Root/A.md", "Root/B.md"], "Root/A.md", "Root/C.md", false))
			.toEqual(["Root/B.md", "Root/C.md"]);
		expect(migrateTrackedFilePaths(["A.md"], "A.md", "A.txt", false)).toEqual(["A.md"]);
	});
});
