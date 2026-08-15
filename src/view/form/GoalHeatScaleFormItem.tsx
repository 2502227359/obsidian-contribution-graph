import { useEffect, useState } from "react";
import {
	DEFAULT_GOAL_HEAT_LEVELS,
	MAX_EDITABLE_GOAL_HEAT_LEVELS,
} from "src/constants";
import { Locals } from "src/i18/messages";
import { GoalHeatLevel, GoalHeatScale } from "src/types";
import { ColorPicker } from "./ColorPicker";
import {
	addGoalHeatLevel,
	copyGoalHeatScale,
	formatGoalHeatLevelRange,
	GoalHeatLevelRatioError,
	removeGoalHeatLevel,
	updateGoalHeatLevel,
	updateGoalHeatLevelRatio,
	validateGoalHeatLevelRatio,
} from "./goalHeatScaleForm";

export function GoalHeatScaleFormItem(props: {
	heatScale?: GoalHeatScale;
	onChange: (heatScale: GoalHeatScale) => void;
}): JSX.Element {
	const local = Locals.get();
	const heatScale = copyGoalHeatScale(props.heatScale);
	const indexedLevels = heatScale.levels
		.map((level, index) => ({ level, index }))
		.sort((a, b) => a.level.minRatio - b.level.minRatio);
	const canAdd = heatScale.levels.length < MAX_EDITABLE_GOAL_HEAT_LEVELS;

	return (
		<div className="goal-heat-level-list">
			{indexedLevels.map(({ level, index }, sortedIndex) => {
				const nextLevel = indexedLevels[sortedIndex + 1]?.level;
				const defaultColor =
					DEFAULT_GOAL_HEAT_LEVELS[sortedIndex]?.color ||
					DEFAULT_GOAL_HEAT_LEVELS[
						DEFAULT_GOAL_HEAT_LEVELS.length - 1
					].color;
				return (
					<GoalHeatLevelRow
						key={`${level.minRatio}-${index}`}
						level={level}
						levelIndex={index}
						nextMinRatio={nextLevel?.minRatio}
						defaultColor={defaultColor}
						heatScale={heatScale}
						onChange={props.onChange}
					/>
				);
			})}
			<div className="goal-heat-level-actions">
				<button
					type="button"
					className="list-add-button goal-heat-level-add"
					disabled={!canAdd}
					onClick={() =>
						props.onChange(addGoalHeatLevel(heatScale))
					}
				>
					<span aria-hidden="true">＋</span>
					{local.form_goal_heat_level_add}
				</button>
				<span className="goal-heat-level-limit">
					{local.form_goal_heat_level_limit.replace(
						"{max}",
						String(MAX_EDITABLE_GOAL_HEAT_LEVELS)
					)}
				</span>
			</div>
		</div>
	);
}

function GoalHeatLevelRow(props: {
	level: GoalHeatLevel;
	levelIndex: number;
	nextMinRatio?: number;
	defaultColor: string;
	heatScale: GoalHeatScale;
	onChange: (heatScale: GoalHeatScale) => void;
}): JSX.Element {
	const local = Locals.get();
	const [percentage, setPercentage] = useState(
		formatEditablePercentage(props.level.minRatio)
	);
	const [error, setError] = useState<GoalHeatLevelRatioError>();
	const zeroLocked = props.level.minRatio === 0;

	useEffect(() => {
		setPercentage(formatEditablePercentage(props.level.minRatio));
		setError(undefined);
	}, [props.level.minRatio]);

	const resetPercentage = () => {
		setPercentage(formatEditablePercentage(props.level.minRatio));
		setError(undefined);
	};

	const commitPercentage = () => {
		if (zeroLocked) {
			resetPercentage();
			return;
		}
		const trimmed = percentage.trim();
		const minRatio = trimmed === "" ? Number.NaN : Number(trimmed) / 100;
		const validation = validateGoalHeatLevelRatio(
			props.heatScale,
			props.levelIndex,
			minRatio
		);
		if (validation) {
			setError(validation);
			return;
		}
		setError(undefined);
		props.onChange(
			updateGoalHeatLevelRatio(
				props.heatScale,
				props.levelIndex,
				minRatio
			)
		);
	};

	const errorMessage =
		error === "DUPLICATE"
			? local.form_goal_heat_level_duplicate
			: error
			? local.form_goal_heat_level_invalid
			: undefined;

	return (
		<div className={`goal-heat-level-item${error ? " has-error" : ""}`}>
			<button
				type="button"
				className="list-remove-button goal-heat-level-remove"
				disabled={zeroLocked || props.heatScale.levels.length <= 1}
				aria-label={local.form_goal_heat_level_remove}
				title={
					zeroLocked
						? local.form_goal_heat_level_zero_locked
						: local.form_goal_heat_level_remove
				}
				onClick={() =>
					props.onChange(
						removeGoalHeatLevel(
							props.heatScale,
							props.levelIndex
						)
					)
				}
			>
				<span aria-hidden="true">×</span>
			</button>
			<label className="goal-heat-level-threshold">
				<span>{local.form_goal_heat_level_threshold}</span>
				<span className="goal-heat-level-percentage-input">
					<input
						type="number"
						min={0}
						step="any"
						readOnly={zeroLocked}
						value={percentage}
						aria-invalid={error ? "true" : undefined}
						onChange={(event) => {
							setPercentage(event.target.value);
							setError(undefined);
						}}
						onBlur={commitPercentage}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							} else if (event.key === "Escape") {
								event.preventDefault();
								resetPercentage();
							}
						}}
					/>
					<span aria-hidden="true">%</span>
				</span>
			</label>
			<span className="goal-heat-level-range">
				{formatGoalHeatLevelRange(
					props.level.minRatio,
					props.nextMinRatio
				)}
			</span>
			<ColorPicker
				color={props.level.color}
				defaultColor={props.defaultColor}
				onChange={(color) => {
					if (color) {
						props.onChange(
							updateGoalHeatLevel(
								props.heatScale,
								props.levelIndex,
								{ color }
							)
						);
					}
				}}
			/>
			<input
				type="text"
				value={props.level.text || ""}
				placeholder="emoji"
				aria-label={local.form_goal_heat_level_emoji}
				className="cell-rule-text"
				onChange={(event) =>
					props.onChange(
						updateGoalHeatLevel(
							props.heatScale,
							props.levelIndex,
							{ text: event.target.value }
						)
					)
				}
			/>
			{errorMessage && (
				<span className="goal-heat-level-error" role="alert">
					{errorMessage}
				</span>
			)}
		</div>
	);
}

function formatEditablePercentage(minRatio: number): string {
	return String(Number((minRatio * 100).toFixed(6)));
}
