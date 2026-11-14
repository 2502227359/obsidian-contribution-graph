import { TimeSpan } from "./types";

export interface TimeTrackerClock {
	wall: () => number;
	monotonic: () => number;
}

export type TimeTrackerStatus = "ACTIVE" | "IDLE";

const DEFAULT_IDLE_TIMEOUT_MINUTES = 5;
const MIN_IDLE_TIMEOUT_MINUTES = 1;
const MAX_IDLE_TIMEOUT_MINUTES = 10080;
const MAX_CHECKPOINT_GAP_MS = 60 * 1000;
const MAX_CLOCK_DRIFT_MS = 2000;

/** 依据用户活动事件维护一个不跨休眠的活跃时长会话。 */
export class TimeTracker {
	private idleTimeoutMinutes: number;
	private path?: string;
	private status: TimeTrackerStatus = "IDLE";
	private lastEmitWall = 0;
	private lastEmitMono = 0;
	private lastActivityMono = 0;
	private lastCheckpointMono = 0;
	private lastObservedWall = 0;
	private lastObservedMono = 0;
	private hasObservedClock = false;
	private lastOffset?: number;

	constructor(
		private readonly onSpan: (span: TimeSpan) => void,
		private readonly clock: TimeTrackerClock,
		idleTimeoutMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES
	) {
		this.idleTimeoutMinutes = validateIdleTimeout(idleTimeoutMinutes);
	}

	activity(path: string): void {
		const normalizedPath = path.trim();
		if (!normalizedPath) {
			this.pause();
			return;
		}
		const now = this.readClock();
		if (!this.path) {
			this.startSession(normalizedPath, now);
			return;
		}
		if (this.status === "ACTIVE") {
			if (this.isClockAnomalous(now) || this.isLongHeartbeatGap(now)) {
				this.resetAfterSleep(now);
			} else {
				this.emitUntil(now.mono);
			}
		}
		if (this.path !== normalizedPath || this.getStatus() === "IDLE") {
			this.startSession(normalizedPath, now);
			return;
		}
		this.lastActivityMono = now.mono;
		this.lastCheckpointMono = now.mono;
		this.observe(now);
	}

	checkpoint(): void {
		if (!this.path) {
			return;
		}
		const now = this.readClock();
		if (
			this.status === "ACTIVE" &&
			(this.isClockAnomalous(now) || this.isLongHeartbeatGap(now))
		) {
			this.resetAfterSleep(now);
			return;
		}
		if (this.status === "ACTIVE") {
			this.emitUntil(now.mono);
		}
		this.lastCheckpointMono = now.mono;
		this.observe(now);
	}

	pause(): void {
		if (!this.path) {
			return;
		}
		const now = this.readClock();
		if (this.status === "ACTIVE") {
			if (this.isClockAnomalous(now) || this.isLongHeartbeatGap(now)) {
				this.resetAfterSleep(now);
			} else {
				this.emitUntil(now.mono);
			}
		}
		this.status = "IDLE";
		this.path = undefined;
		this.resetClockState();
	}

	setIdleTimeout(minutes: number): void {
		const next = validateIdleTimeout(minutes);
		if (next === this.idleTimeoutMinutes) {
			return;
		}
		this.pause();
		this.idleTimeoutMinutes = next;
	}

	getStatus(): TimeTrackerStatus {
		return this.status;
	}

	private startSession(
		path: string,
		now: { wall: number; mono: number; offset: number }
	): void {
		this.path = path;
		this.status = "ACTIVE";
		this.lastEmitWall = now.wall;
		this.lastEmitMono = now.mono;
		this.lastActivityMono = now.mono;
		this.lastCheckpointMono = now.mono;
		this.observe(now);
	}

	private emitUntil(endMono: number): void {
		if (!this.path || this.status !== "ACTIVE") {
			return;
		}
		const idleEndMono =
			this.lastActivityMono + this.idleTimeoutMinutes * 60 * 1000;
		const cappedEndMono = Math.min(endMono, idleEndMono);
		if (cappedEndMono > this.lastEmitMono) {
			const elapsed = (cappedEndMono - this.lastEmitMono) / 1000;
			const mappedEndWall =
				this.lastEmitWall + (cappedEndMono - this.lastEmitMono);
			this.onSpan({
				path: this.path,
				start: this.lastEmitWall,
				end: mappedEndWall,
				seconds: elapsed,
			});
			this.lastEmitMono = cappedEndMono;
			this.lastEmitWall = mappedEndWall;
		}
		if (endMono >= idleEndMono) {
			this.status = "IDLE";
		}
	}

	private readClock(): { wall: number; mono: number; offset: number } {
		const wall = this.clock.wall();
		const mono = this.clock.monotonic();
		return { wall, mono, offset: new Date(wall).getTimezoneOffset() * -1 };
	}

	private observe(now: { wall: number; mono: number; offset: number }): void {
		this.lastObservedWall = now.wall;
		this.lastObservedMono = now.mono;
		this.hasObservedClock = true;
		this.lastOffset = now.offset;
	}

	private isClockAnomalous(now: {
		wall: number;
		mono: number;
		offset: number;
	}): boolean {
		if (!this.hasObservedClock) {
			return false;
		}
		const monoDelta = now.mono - this.lastObservedMono;
		const wallDelta = now.wall - this.lastObservedWall;
		return (
			monoDelta < 0 ||
			wallDelta < 0 ||
			Math.abs(wallDelta - monoDelta) > MAX_CLOCK_DRIFT_MS ||
			(this.lastOffset !== undefined && now.offset !== this.lastOffset)
		);
	}

	private isLongHeartbeatGap(now: { mono: number }): boolean {
		return (
			this.status === "ACTIVE" &&
			now.mono - this.lastCheckpointMono > MAX_CHECKPOINT_GAP_MS
		);
	}

	private resetAfterSleep(now: {
		wall: number;
		mono: number;
		offset: number;
	}): void {
		this.status = "IDLE";
		this.lastEmitWall = now.wall;
		this.lastEmitMono = now.mono;
		this.lastActivityMono = now.mono;
		this.lastCheckpointMono = now.mono;
		this.observe(now);
	}

	private resetClockState(): void {
		this.lastEmitWall = 0;
		this.lastEmitMono = 0;
		this.lastActivityMono = 0;
		this.lastCheckpointMono = 0;
		this.lastObservedWall = 0;
		this.lastObservedMono = 0;
		this.hasObservedClock = false;
		this.lastOffset = undefined;
	}
}

function validateIdleTimeout(minutes: number): number {
	if (
		!Number.isSafeInteger(minutes) ||
		minutes < MIN_IDLE_TIMEOUT_MINUTES ||
		minutes > MAX_IDLE_TIMEOUT_MINUTES
	) {
		throw new RangeError("空闲阈值必须是 1 到 10080 分钟之间的整数");
	}
	return minutes;
}
