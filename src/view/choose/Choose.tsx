import { useEffect, useState } from "react";

export function Choose(props: {
	options: ChooseOption[];
	defaultValue: string;
	onChoose: (option: ChooseOption) => void;
}): JSX.Element {
	const { onChoose } = props;
	const [selectedValue, setSelectedValue] = useState(props.defaultValue);

	useEffect(() => {
		setSelectedValue(props.defaultValue);
	}, [props.defaultValue]);

	const choosed = (option: ChooseOption) => {
		setSelectedValue(option.value);
		onChoose(option);
	};
	return (
		<div className="contribution-graph-choose" role="group">
			{props.options.map((option) => {
				const selected = option.value == selectedValue;
				return (
					<button
						type="button"
						key={option.value}
						className={selected ? "item choosed" : "item"}
						aria-label={option.tip}
						aria-pressed={selected}
						title={option.tip}
						onClick={() => choosed(option)}
					>
						<span className="icon" aria-hidden="true">
							{option.icon}
						</span>
					</button>
				);
			})}
		</div>
	);
}

export class ChooseOption {
	constructor(
		public tip: string,
		public icon: JSX.Element,
		public value: string
	) {}
}
