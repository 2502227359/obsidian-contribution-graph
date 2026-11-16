const PALETTE = ["#85a1d5", "#69aca3", "#ae99c9", "#cea477", "#c891a0", "#9caf82", "#89acba", "#bc9b84"];
export function colorFor(id:string):string {if(id==="notes")return "#85a1d5";if(id==="activity:yolo")return "#69aca3";let hash=0;for(let i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))>>>0;return PALETTE[hash%PALETTE.length];}
export function axisDuration(seconds: number): string {
	if (!seconds) return "0";
	if (seconds < 60) return `${Math.round(seconds)}秒`;
	return seconds < 3600 ? `${Math.round(seconds / 6) / 10}分` : `${Math.round(seconds / 360) / 10}时`;
}
export function detailDuration(seconds: number): string {
	if (seconds > 0 && seconds < 1) return "少于1秒";
	const value = Math.floor(seconds), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), tail = value % 60;
	return [hours ? `${hours}小时` : "", minutes ? `${minutes}分钟` : "", tail ? `${tail}秒` : ""].filter(Boolean).join(" ") || "0秒";
}
