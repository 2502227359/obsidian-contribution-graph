const PALETTE = ["#4c8bf5", "#34a89a", "#8e7cc3", "#e68a4d", "#d86b86", "#64a875", "#4ca1bd", "#c68863"];
const AXIS_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200, 86400, 172800, 259200, 518400, 604800, 1209600, 2592000, 5184000, 7776000, 10368000, 15552000, 31536000];
let chartHeadingSequence = 0;

/** 宿主把 aria-label 当作悬浮提示，改用标题关联保留可读名称。 */
export function labelReviewChart(host:HTMLElement,heading:HTMLElement):void {
	if(!heading.id)heading.id=`cg-review-chart-heading-${++chartHeadingSequence}`;
	host.setAttribute("role","img");
	host.setAttribute("aria-labelledby",heading.id);
}

export function colorFor(id:string):string {if(id==="notes")return "#4c8bf5";if(id==="activity:yolo")return "#34a89a";let hash=0;for(let i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))>>>0;return PALETTE[hash%PALETTE.length];}
export function axisDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0";
	if (seconds < 1) return "少于1秒";
	let value = Math.max(1, Math.round(seconds));
	const days = Math.floor(value / 86400); value %= 86400;
	const hours = Math.floor(value / 3600); value %= 3600;
	const minutes = Math.floor(value / 60); value %= 60;
	return [days ? `${days}天` : "", hours ? `${hours}小时` : "", minutes ? `${minutes}分` : "", value ? `${value}秒` : ""].filter(Boolean).join("") || "0";
}
export function detailDuration(seconds: number): string {
	if (seconds > 0 && seconds < 1) return "少于1秒";
	const value = Math.floor(seconds), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), tail = value % 60;
	return [hours ? `${hours}小时` : "", minutes ? `${minutes}分钟` : "", tail ? `${tail}秒` : ""].filter(Boolean).join(" ") || "0秒";
}

export function timeAxisOptions(maxSeconds: number): { min: 0; max: number; interval: number; axisLabel: { formatter: typeof axisDuration } } {
	const actual = Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds : 0;
	const interval = niceAxisInterval(actual);
	const roundedMax = actual ? Math.ceil(actual / interval) * interval : interval;
	return {min: 0, max: Number.isFinite(roundedMax) ? Math.max(interval, roundedMax) : actual, interval, axisLabel: {formatter: axisDuration}};
}

function niceAxisInterval(maxSeconds: number): number {
	if (!maxSeconds) return 1;
	const target = maxSeconds / 6;
	for (const interval of AXIS_INTERVALS) if (interval >= target) return interval;
	const days = target / 86400, magnitude = 10 ** Math.floor(Math.log10(days));
	for (const factor of [1, 2, 5, 10]) {
		const interval = factor * magnitude * 86400;
		if (Number.isFinite(interval) && interval >= target) return interval;
	}
	return Math.max(1, Math.ceil(target / 86400) * 86400);
}
