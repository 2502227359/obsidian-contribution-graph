import { DEFAULT_GOAL_HEAT_LEVELS } from "src/constants";
import { GoalHeatScale } from "src/types";
import { ColorPicker } from "./ColorPicker";
import {
	copyGoalHeatScale,
	formatGoalHeatLevelRange,
	updateGoalHeatLevel,
} from "./goalHeatScaleForm";

export function GoalHeatScaleFormItem(props: {
	heatScale?: GoalHeatScale;
	onChange: (heatScale: GoalHeatScale) => void;
}): JSX.Element {
	const heatScale = copyGoalHeatScale(props.heatScale);
	const indexedLevels = heatScale.levels
		.map((level, index) => ({ level, index }))
		.sort((a, b) => a.level.minRatio - b.level.minRatio);

	return (
		<div className="goal-heat-level-list">
			{indexedLevels.map(({ level, index }, sortedIndex) => {
				const nextLevel = indexedLevels[sortedIndex + 1]?.level;
				const defaultColor =
					DEFAULT_GOAL_HEAT_LEVELS[index]?.color ||
					DEFAULT_GOAL_HEAT_LEVELS[
						DEFAULT_GOAL_HEAT_LEVELS.length - 1
					].color;
				return (
					<div
						className="goal-heat-level-item"
						key={`${level.minRatio}-${index}`}
					>
						<span className="goal-heat-level-range">
							{formatGoalHeatLevelRange(
								level.minRatio,
								nextLevel?.minRatio
							)}
						</span>
						<ColorPicker
							color={level.color}
							defaultColor={defaultColor}
							onChange={(color) => {
								if (!color) {
									return;
								}
								props.onChange(
									updateGoalHeatLevel(
										heatScale,
										index,
										{ color }
									)
								);
							}}
						/>
						<input
							type="text"
							value={level.text || ""}
							placeholder="emoji"
							className="cell-rule-text"
							onChange={(event) =>
								props.onChange(
									updateGoalHeatLevel(
										heatScale,
										index,
										{ text: event.target.value }
									)
								)
							}
						/>
					</div>
				);
			})}
		</div>
	);
}
