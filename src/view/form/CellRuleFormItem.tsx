import {
	useFloating,
	offset,
	flip,
	shift,
	inline,
	autoUpdate,
	useDismiss,
	useInteractions,
} from "@floating-ui/react";
import { Chrome, ColorResult } from "@uiw/react-color";
import { useState } from "react";
import { CellStyleRule } from "src/types";

export function CellRuleItem(props: {
	rule: CellStyleRule;
	onChange: (rule: CellStyleRule) => void;
	onRemove: (id: string) => void;
}): JSX.Element {
	const [rule, setRule] = useState(props.rule);
	const [showColorPicker, setShowColorPicker] = useState(false);
	const changeRule = (name: string, value: any) => {
		const newRule = { ...rule, [name]: value };
		setRule(newRule);
		props.onChange(newRule);
	};

	const { refs, floatingStyles, context } = useFloating({
		open: showColorPicker,
		onOpenChange: (open) => setShowColorPicker(open),
		middleware: [offset(8), flip(), shift({ padding: 8 }), inline()],
		whileElementsMounted: autoUpdate,
	});

	const dismiss = useDismiss(context);
	const { getFloatingProps } = useInteractions([dismiss]);

	return (
		<div className="form-item">
			<div className="form-content" ref={refs.setReference}>
				<button
					type="button"
					className="list-remove-button"
					aria-label="删除规则"
					title="删除规则"
					//@ts-ignore
					onClick={() => props.onRemove(props.rule.id)}
				>
					<svg
						viewBox="0 0 24 24"
						width="14"
						height="14"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
				<input
					type="number"
					defaultValue={props.rule.min}
					placeholder="最小"
					className="cell-rule-value"
					onChange={(e) => changeRule("min", e.target.value)}
				/>
				<span>≤</span>
				<span>贡献值</span>
				<span>＜</span>
				<input
					type="number"
					defaultValue={props.rule.max}
					placeholder="最大"
					className="cell-rule-value"
					onChange={(e) => changeRule("max", e.target.value)}
				/>
				<span>=</span>
				<button
					type="button"
					className="color-indicator"
					aria-label="选择规则颜色"
					style={{
						backgroundColor: props.rule.color,
					}}
					onClick={() => setShowColorPicker(!showColorPicker)}
				></button>
				{showColorPicker ? (
					<div
						ref={refs.setFloating}
						className="cg-color-popover"
						style={{
							...floatingStyles,
						}}
						{...getFloatingProps()}
					>
						<Chrome
							color={props.rule.color}
							onChange={(color: ColorResult) => {
								changeRule("color", color.hexa);
							}}
						/>
					</div>
				) : null}
				<input
					type="text"
					defaultValue={props.rule.text}
					placeholder="表情"
					className="cell-rule-text"
					onChange={(e) => changeRule("text", e.target.value)}
				/>
			</div>
		</div>
	);
}
