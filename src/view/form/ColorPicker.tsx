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

export function ColorPicker(props: {
	color?: string;
	defaultColor?: string;
	ariaLabel?: string;
	onChange: (color?: string) => void;
	onReset?: (color?: string) => void;
}): JSX.Element {
	const [showColorPicker, setShowColorPicker] = useState(false);
	const { refs, floatingStyles, context } = useFloating({
		open: showColorPicker,
		onOpenChange: (open) => setShowColorPicker(open),
		middleware: [offset(8), flip(), shift({ padding: 8 }), inline()],
		whileElementsMounted: autoUpdate,
	});

	const dismiss = useDismiss(context);
	const { getFloatingProps } = useInteractions([dismiss]);

	return (
		<>
			<button
				ref={refs.setReference}
				type="button"
				className="color-indicator"
				aria-label={props.ariaLabel || "选择颜色"}
				style={{
					backgroundColor: props.color,
				}}
				onClick={() => setShowColorPicker(!showColorPicker)}
			></button>
			{props.color && (
				<div className="color-label">
					<span>{props.color}</span>
					<button
						type="button"
						className="color-reset-button"
						aria-label="重置颜色"
						title="重置颜色"
						onClick={() => {
							if (props.onReset) {
								props.onReset(props.defaultColor);
							} else {
								props.onChange(props.defaultColor);
							}
						}}
					>
						<svg
							viewBox="0 0 24 24"
							width="11"
							height="11"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				</div>
			)}
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
						color={props.color || "#FFFFFF"}
						onChange={(color: ColorResult) => {
							props.onChange(color.hexa);
						}}
					/>
				</div>
			) : null}
		</>
	);
}
