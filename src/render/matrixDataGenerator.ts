import { diffCalendarDays, parseDate } from "../util/dateUtils";
import {
	Contribution,
	ContributionCellData,
	CollectionScopePeriod,
	TrackingPeriod,
} from "../types";
import { DateTime } from "luxon";
import { areFoldersCoveredByScope } from "../activity/folderScope";

export type TrackingState = "TRACKED" | "PARTIAL" | "UNTRACKED";

export function generateByData(
	data: Contribution[],
	trackingPeriods?: TrackingPeriod[],
	collectionScopePeriods?: CollectionScopePeriod[],
	activityFolders: string[] = []
) {
	if (!data || data.length === 0) {
		return [];
	}

	const dateData = data.map((item) => {
		if (item.date instanceof Date) {
			return {
				...item,
				timestamp: item.date.getTime(),
			};
		} else {
			const localDate = parseDate(item.date);
			return {
				...item,
				date: localDate,
				timestamp: localDate.getTime(),
			};
		}
	});

	const sortedData = dateData.sort((a, b) => b.timestamp - a.timestamp);
	const min = sortedData[sortedData.length - 1].timestamp;
	const max = sortedData[0].timestamp;
	return generateByFixedDate(
		new Date(min),
		new Date(max),
		data,
		trackingPeriods,
		collectionScopePeriods,
		activityFolders
	);
}

export function generateByFixedDate(
	from: Date,
	to: Date,
	data: Contribution[],
	trackingPeriods?: TrackingPeriod[],
	collectionScopePeriods?: CollectionScopePeriod[],
	activityFolders: string[] = []
) {
	const days = diffCalendarDays(from, to) + 1;
	if (days <= 0) {
		return [];
	}
	// convert contributions to map: date(yyyy-MM-dd) -> value(sum)
	const contributionMapByDate = contributionToMap(data);

	const cellData: ContributionCellData[] = [];

	const toDateTime = DateTime.fromJSDate(to);
	const today = DateTime.local().startOf("day");
	// fill data
	for (let i = 0; i < days; i++) {
		const currentDateAtIndex = toDateTime.minus({ days: i });
		const isoDate = currentDateAtIndex.toFormat('yyyy-MM-dd');
		const contribution = contributionMapByDate.get(isoDate);
		const future =
			trackingPeriods !== undefined &&
			currentDateAtIndex.startOf("day") > today;
		const trackingState = trackingPeriods
			? future
				? undefined
				: getDateTrackingState(
						isoDate,
						trackingPeriods,
						collectionScopePeriods,
						activityFolders
				  )
			: undefined;
		const tracked = trackingState
			? trackingState !== "UNTRACKED"
			: undefined;

		cellData.unshift({
			date: isoDate,
			weekDay: currentDateAtIndex.weekday == 7 ? 0 : currentDateAtIndex.weekday,
			month: currentDateAtIndex.month - 1,
			monthDate: currentDateAtIndex.day,
			year: currentDateAtIndex.year,
			value: contribution ? contribution.value : 0,
			summary: contribution ? contribution.summary : undefined,
			items: contribution ? contribution.items || [] : [],
			editStats: contribution?.editStats,
			timeStats: contribution?.timeStats,
			tracked: contribution?.timeStats ? contribution.timeStats.trackingState !== "UNTRACKED" : tracked,
			trackingState: contribution?.timeStats?.trackingState || trackingState,
			future: contribution?.timeStats?.future ?? future,
		});
	}

	return cellData;
}

/**
 * - generate two-dimensional matrix data
 * - every column is week, from Sunday to Saturday
 * - every cell is a day
 */
export function generateByLatestDays(
	days: number,
	data: Contribution[] = [],
	trackingPeriods?: TrackingPeriod[],
	collectionScopePeriods?: CollectionScopePeriod[],
	activityFolders: string[] = []
): ContributionCellData[] {
	const toDate = new Date();
	toDate.setHours(0, 0, 0, 0);
	const fromDate = new Date(toDate);
	fromDate.setDate(fromDate.getDate() - days + 1);
	return generateByFixedDate(
		fromDate,
		toDate,
		data,
		trackingPeriods,
		collectionScopePeriods,
		activityFolders
	);
}

export function isDateTracked(
	date: string,
	trackingPeriods: TrackingPeriod[]
): boolean {
	return trackingPeriods.some(
		(period) =>
			date >= period.startDate &&
			(!period.endDate || date <= period.endDate)
	);
}

export function getDateTrackingState(
	date: string,
	trackingPeriods: TrackingPeriod[],
	collectionScopePeriods?: CollectionScopePeriod[],
	activityFolders: string[] = []
): TrackingState {
	if (!isDateTracked(date, trackingPeriods)) {
		return "UNTRACKED";
	}
	if (!collectionScopePeriods) {
		return "TRACKED";
	}
	const scopes = collectionScopePeriods.filter(
		(period) =>
			date >= period.startDate &&
			(!period.endDate || date <= period.endDate)
	);
	if (scopes.length === 0) {
		return "UNTRACKED";
	}
	const coveredCount = scopes.filter((period) =>
		areFoldersCoveredByScope(activityFolders, period.folders)
	).length;
	if (coveredCount === scopes.length) {
		return "TRACKED";
	}
	return coveredCount > 0 ? "PARTIAL" : "UNTRACKED";
}

function contributionToMap(data: Contribution[]) {
	const map = new Map<string, Contribution>();
	for (const item of data) {
		let key;
		if (typeof item.date === "string") {
			key = item.date;
		} else {
			key = DateTime.fromJSDate(item.date).toFormat('yyyy-MM-dd');
		}
		if (map.has(key)) {
			const newItem = {
				...item,
				// @ts-ignore
				value: map.get(key).value + item.value,
			};
			map.set(key, newItem);
		} else {
			map.set(key, item);
		}
	}
	return map;
}
