import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as paths from "node:path";
import * as cryptoApi from "node:crypto";
import { tmpdir } from "node:os";
import { StatisticsFiles, StatisticsRepository } from "../src/activity/StatisticsRepository";
import { AiEditEvent, parseAiEditEvent } from "../src/activity/aiEditProtocol";
import { AiEditSpool } from "../src/activity/aiEditSpool";
import { emptyStatistics } from "../src/activity/statisticsModel";

const installation = "fe8aa9dd-7eea-45d7-85ec-1fdc78299765";

function setup() {
	const contents = new Map<string, string>();
	const fs: StatisticsFiles = {
		list: async () => [...contents.keys()],
		read: async path => contents.get(path)!,
		write: async (path, content) => { contents.set(path, content); },
	};
	const start = async (id = installation) => {
		const repo = new StatisticsRepository(fs, data => data as ReturnType<typeof emptyStatistics>, undefined, { id });
		await repo.initialize();
		return repo;
	};
	return { start, fs };
}

function edit(changes: Partial<AiEditEvent> = {}): AiEditEvent {
	return { version: 1, id: crypto.randomUUID(), date: "2026-11-26", occurredAt: 1795700000000,
		source: "pi", path: "临床医学/笔记.md", generation: "initial", addedChars: 3, deletedChars: 1, ...changes };
}

describe("AI 编辑入账", () => {
	it("多来源重投、重启及另一设备读取不会重复累计", async () => {
		const { start } = setup();
		const first = await start();
		const edits = [edit(), edit({ source: "agy", addedChars: 2 })];
		await first.saveAiEdits([edits[0], ...edits]);
		await first.saveAiEdits(edits);
		const restarted = await start();
		await restarted.saveAiEdits(edits);
		const other = await start(crypto.randomUUID());
		expect(other.read(emptyStatistics()).dailyStats["2026-11-26"]).toMatchObject({
			addedChars: 5, deletedChars: 2,
			aiAddedChars: 5, aiDeletedChars: 2,
			documents: { "临床医学/笔记.md": { addedChars: 5, deletedChars: 2, aiAddedChars: 5, aiDeletedChars: 2 } },
		});
	});

	it("区分手动编辑与 AI 编辑（含仅带 aiEventIds 的历史 AI 记录）并保留拆分结果", async () => {
		const { start, fs: memFs } = setup();
		const repo = await start();
		// 写入手动统计
		const manual = emptyStatistics();
		manual.dailyStats["2026-11-26"] = {
			addedChars: 10, deletedChars: 4,
			documents: { "临床医学/笔记.md": { addedChars: 10, deletedChars: 4 } },
		};
		await repo.save(manual);
		// 写入 AI 统计
		await repo.saveAiEdits([edit({ addedChars: 6, deletedChars: 2 })]);

		// 额外注入一条不含 aiAddedChars 字段的旧版 AI 记录，验证向后兼容识别
		const legacyAiId = crypto.randomUUID();
		await memFs.write(`记录/${legacyAiId}-r1.json`, JSON.stringify({
			formatVersion: 1,
			kind: "statistics",
			id: legacyAiId,
			revision: 1,
			updatedAt: 1795700001000,
			generation: "initial",
			aiEventIds: [crypto.randomUUID()],
			data: {
				...emptyStatistics(),
				dailyStats: {
					"2026-11-26": {
						addedChars: 3, deletedChars: 1,
						documents: { "临床医学/笔记.md": { addedChars: 3, deletedChars: 1 } },
					},
				},
			},
		}));

		const reloaded = await start(crypto.randomUUID());
		const merged = reloaded.read(emptyStatistics()).dailyStats["2026-11-26"];
		expect(merged).toMatchObject({
			addedChars: 19,
			deletedChars: 7,
			aiAddedChars: 9,
			aiDeletedChars: 3,
			documents: {
				"临床医学/笔记.md": { addedChars: 19, deletedChars: 7, aiAddedChars: 9, aiDeletedChars: 3 },
			},
		});
	});

	it("写入失败保留可重试状态，清空后不复活旧事件", async () => {
		const { start, fs } = setup();
		const repo = await start();
		const event = edit();
		const write = fs.write;
		fs.write = async () => { throw new Error("写入失败"); };
		await expect(repo.saveAiEdits([event])).rejects.toThrow("写入失败");
		expect(repo.read(emptyStatistics()).dailyStats).toEqual({});
		fs.write = write;
		await repo.saveAiEdits([event]);
		await repo.replace(emptyStatistics());
		await repo.saveAiEdits([event, edit()]);
		expect(repo.read(emptyStatistics()).dailyStats).toEqual({});
	});

	it("实际写入后读取校验失败，重试不会再次增加字符", async () => {
		const { start, fs } = setup();
		const repo = await start();
		const read = fs.read;
		let fail = true;
		fs.read = async path => {
			if (!fail) return read(path);
			fail = false;
			throw new Error("回读失败");
		};
		const event = edit();
		await expect(repo.saveAiEdits([event])).rejects.toThrow("回读失败");
		await repo.saveAiEdits([event]);
		expect((await start()).read(emptyStatistics()).dailyStats[event.date].addedChars).toBe(3);
	});

	it("校验来源记录、路径和实际日历日期", () => {
		const event = edit();
		expect(parseAiEditEvent(event)).toEqual(event);
		expect(parseAiEditEvent({ ...event, path: "../笔记.md" })).toBeUndefined();
		expect(parseAiEditEvent({ ...event, date: "2026-02-31" })).toBeUndefined();
		expect(parseAiEditEvent({ ...event, addedChars: -2 })).toBeUndefined();
	});

	it("重启只补录已确认落盘的待处理写入", async () => {
		const root = fs.mkdtempSync(paths.join(tmpdir(), "ai-edit-receipt-"));
		try {
			const vault = paths.join(root, "vault");
			const spoolRoot = paths.join(root, "spool");
			const event = edit(), unmatched = edit({ path: "临床医学/未写入.md" });
			fs.mkdirSync(paths.join(vault, "临床医学"), { recursive: true });
			fs.mkdirSync(paths.join(spoolRoot, "receipts"), { recursive: true });
			fs.writeFileSync(paths.join(vault, event.path), "新版");
			const afterDigest = cryptoApi.createHash("sha256").update("新版").digest("hex");
			for (const item of [event, unmatched]) {
				const path = paths.join(spoolRoot, "receipts", `${item.id}.json`);
				fs.writeFileSync(path, JSON.stringify({ version: 1, id: item.id, event: item, afterDigest }));
			}
			const spool = new AiEditSpool(fs, paths, spoolRoot, fs.realpathSync(vault), cryptoApi);
			expect(spool.read()).toEqual([event]);
			const { start } = setup();
			const repo = await start();
			await repo.saveAiEdits(spool.read());
			spool.acknowledge([event]);
			expect(spool.read()).toEqual([]);
			expect(fs.readdirSync(paths.join(spoolRoot, "receipts"))).toEqual([`${unmatched.id}.json`]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
