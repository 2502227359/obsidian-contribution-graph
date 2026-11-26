import { AiNoteError, AiWritePolicy, DEFAULT_DESTRUCTIVE_DELETION_MIN_CHARS, DEFAULT_DESTRUCTIVE_DELETION_RATIO } from "./aiEditProtocol";

export type NoteEol = "\r\n" | "\n";

export interface NotePatchEdit {
	oldText: string;
	newText: string;
	replaceAll?: boolean;
}

export interface PatchApplicationResult {
	content: string;
	eol: NoteEol;
	appliedCount: number;
}

export interface NoteLineSlice {
	content: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
}

export function detectNoteEol(content: string): NoteEol {
	const crlfCount = (content.match(/\r\n/g) ?? []).length;
	const totalLfCount = (content.match(/\n/g) ?? []).length;
	const lfOnlyCount = totalLfCount - crlfCount;
	return crlfCount > 0 && crlfCount >= lfOnlyCount ? "\r\n" : "\n";
}

export function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

export function restoreLineEndings(content: string, eol: NoteEol): string {
	const normalized = normalizeLineEndings(content);
	return eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export function sliceNoteLines(content: string, startLine?: number, endLine?: number): NoteLineSlice {
	const normalized = normalizeLineEndings(content);
	const lines = normalized === "" ? [] : normalized.split("\n");
	const totalLines = lines.length;
	if (startLine === undefined && endLine === undefined) {
		return { content, startLine: totalLines ? 1 : 0, endLine: totalLines, totalLines, truncated: false };
	}
	const start = startLine ?? 1;
	const end = endLine ?? totalLines;
	if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) {
		throw new AiNoteError("INVALID_REQUEST", "startLine 与 endLine 必须是有效的正整数范围");
	}
	if (totalLines === 0 || start > totalLines) {
		return { content: "", startLine: start, endLine: Math.min(end, totalLines), totalLines, truncated: false };
	}
	const clampedEnd = Math.min(end, totalLines);
	const eol = detectNoteEol(content);
	return {
		content: lines.slice(start - 1, clampedEnd).join(eol),
		startLine: start,
		endLine: clampedEnd,
		totalLines,
		truncated: start > 1 || clampedEnd < totalLines,
	};
}

export function applyNotePatches(
	beforeContent: string,
	edits: readonly NotePatchEdit[],
	preserveEol = true,
): PatchApplicationResult {
	if (!Array.isArray(edits) || edits.length === 0) {
		throw new AiNoteError("INVALID_REQUEST", "patch_note 至少需要一条编辑操作");
	}
	const originalEol = detectNoteEol(beforeContent);
	let current = normalizeLineEndings(beforeContent);
	let appliedCount = 0;

	for (let index = 0; index < edits.length; index++) {
		const edit = edits[index];
		if (!edit || typeof edit.oldText !== "string" || typeof edit.newText !== "string" || edit.oldText.length === 0) {
			throw new AiNoteError("INVALID_REQUEST", `第 ${index + 1} 条补丁缺少有效的 oldText 或 newText`);
		}
		const target = normalizeLineEndings(edit.oldText);
		const replacement = normalizeLineEndings(edit.newText);
		const positions = findOccurrences(current, target);
		if (positions.length === 0) {
			throw new AiNoteError("PATCH_NOT_FOUND", `第 ${index + 1} 条补丁未在当前笔记中找到匹配文本`, {
				details: { editIndex: index },
			});
		}
		if (positions.length > 1 && !edit.replaceAll) {
			const matchLines = positions.slice(0, 10).map(offset => lineNumberAt(current, offset));
			throw new AiNoteError(
				"PATCH_AMBIGUOUS",
				`第 ${index + 1} 条补丁匹配到 ${positions.length} 处（行号：${matchLines.join(", ")}），请补充更多上下文以确保唯一匹配`,
				{ details: { editIndex: index, matchCount: positions.length, matchLines } },
			);
		}
		if (edit.replaceAll) {
			current = current.split(target).join(replacement);
			appliedCount += positions.length;
		} else {
			const at = positions[0];
			current = `${current.slice(0, at)}${replacement}${current.slice(at + target.length)}`;
			appliedCount += 1;
		}
	}

	const output = preserveEol ? restoreLineEndings(current, originalEol) : current;
	return { content: output, eol: originalEol, appliedCount };
}

export interface IntegrityCheckOptions {
	operation: "write" | "patch";
	confirmDestructive?: boolean;
	writePolicy?: AiWritePolicy;
}

export function verifyNoteIntegrity(
	beforeContent: string,
	afterContent: string,
	options: IntegrityCheckOptions,
): string[] {
	const warnings: string[] = [];
	if (!beforeContent) return warnings;

	const before = normalizeLineEndings(beforeContent);
	const after = normalizeLineEndings(afterContent);

	// 1. YAML frontmatter integrity guard
	const beforeFrontmatter = inspectFrontmatter(before);
	const afterFrontmatter = inspectFrontmatter(after);
	if (beforeFrontmatter === "valid" && afterFrontmatter === "unclosed") {
		throw new AiNoteError("STRUCTURE_GUARD_BLOCKED", "本次修改破坏了 YAML Frontmatter 的闭合分隔线（---）", {
			details: { reason: "unclosed-frontmatter" },
		});
	}
	if (beforeFrontmatter === "valid" && afterFrontmatter === "none" && !options.confirmDestructive) {
		throw new AiNoteError(
			"STRUCTURE_GUARD_BLOCKED",
			"原笔记包含 YAML Frontmatter，但修改后整个 Frontmatter 被移除；如确需删除请传入 confirmDestructive: true",
			{ details: { reason: "dropped-frontmatter" } },
		);
	}

	// 2. Full-file write protection against accidental loss of embeds/block IDs
	if (options.operation === "write" && !options.confirmDestructive) {
		const lostEmbeds = diffMarkerCounts(extractEmbeds(before), extractEmbeds(after));
		if (lostEmbeds.length > 0) {
			throw new AiNoteError(
				"STRUCTURE_GUARD_BLOCKED",
				`整篇写入丢失了 ${lostEmbeds.length} 个原有图片或附件嵌入（例如 ${lostEmbeds[0]}）；建议改用 patch_note 局部修改，或确认无误后传入 confirmDestructive: true`,
				{ details: { reason: "dropped-embeds", lostCount: lostEmbeds.length, samples: lostEmbeds.slice(0, 5) } },
			);
		}
		const lostBlockIds = diffMarkerCounts(extractBlockIds(before), extractBlockIds(after));
		if (lostBlockIds.length > 0) {
			throw new AiNoteError(
				"STRUCTURE_GUARD_BLOCKED",
				`整篇写入丢失了 ${lostBlockIds.length} 个原有块引用 ID（例如 ${lostBlockIds[0]}）；建议改用 patch_note 局部修改，或确认无误后传入 confirmDestructive: true`,
				{ details: { reason: "dropped-block-ids", lostCount: lostBlockIds.length, samples: lostBlockIds.slice(0, 5) } },
			);
		}
	}

	// 3. Large deletion guard
	const ratio = options.writePolicy?.destructiveDeletionRatio ?? DEFAULT_DESTRUCTIVE_DELETION_RATIO;
	const minChars = options.writePolicy?.destructiveDeletionMinChars ?? DEFAULT_DESTRUCTIVE_DELETION_MIN_CHARS;
	if (!options.confirmDestructive && before.length >= minChars && after.length < before.length) {
		const shrinkRatio = (before.length - after.length) / before.length;
		if (shrinkRatio > ratio) {
			throw new AiNoteError(
				"DESTRUCTIVE_EDIT_BLOCKED",
				`本次修改使笔记正文缩减了 ${Math.round(shrinkRatio * 100)}%（${before.length} → ${after.length} 字符），超过安全阈值 ${Math.round(ratio * 100)}%；请核对是否遗漏章节，确认后可传入 confirmDestructive: true`,
				{ details: { beforeLength: before.length, afterLength: after.length, shrinkRatio: Number(shrinkRatio.toFixed(3)) } },
			);
		}
	}

	return warnings;
}

function inspectFrontmatter(content: string): "none" | "valid" | "unclosed" {
	const stripped = content.startsWith("\uFEFF") ? content.slice(1) : content;
	if (!/^---[ \t]*\n/.test(stripped)) return "none";
	const rest = stripped.slice(stripped.indexOf("\n") + 1);
	return /^(?:---|\.\.\.)[ \t]*(?:\n|$)/m.test(rest) ? "valid" : "unclosed";
}

function extractEmbeds(content: string): string[] {
	const embeds: string[] = [];
	const pattern = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(content)) !== null) {
		embeds.push(match[0]);
	}
	return embeds;
}

function extractBlockIds(content: string): string[] {
	const ids: string[] = [];
	const pattern = /(?:^|\s)(\^[A-Za-z0-9-]+)[ \t]*$/gm;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(content)) !== null) {
		ids.push(match[1]);
	}
	return ids;
}

function diffMarkerCounts(before: readonly string[], after: readonly string[]): string[] {
	const afterCounts = new Map<string, number>();
	for (const item of after) afterCounts.set(item, (afterCounts.get(item) ?? 0) + 1);
	const lost: string[] = [];
	for (const item of before) {
		const remaining = afterCounts.get(item) ?? 0;
		if (remaining > 0) afterCounts.set(item, remaining - 1);
		else lost.push(item);
	}
	return lost;
}

function findOccurrences(haystack: string, needle: string): number[] {
	const positions: number[] = [];
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const found = haystack.indexOf(needle, from);
		if (found < 0) break;
		positions.push(found);
		from = found + needle.length;
	}
	return positions;
}

function lineNumberAt(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) {
		if (content.charCodeAt(i) === 10) line++;
	}
	return line;
}
