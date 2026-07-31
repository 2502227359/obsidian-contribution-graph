import { describe, expect, it } from "vitest";
import {
	areFoldersCoveredByScope,
	isFileInTrackedFolders,
	migrateTrackedFolderPaths,
	normalizeTrackedFolderPath,
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
});
