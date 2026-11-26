import { ReactNode, forwardRef, useId, useRef, useState } from "react";

export function getTabId(index: number, instanceId: string): string {
	return `contribution-graph-${instanceId}-tab-${index}`;
}

export function getTabPanelId(index: number, instanceId: string): string {
	return `contribution-graph-${instanceId}-tabpanel-${index}`;
}

export function resolveTabIndex(
	currentIndex: number,
	key: string,
	count: number
): number {
	if (count <= 0) {
		return 0;
	}
	const current = Math.min(Math.max(currentIndex, 0), count - 1);
	if (key === "Home") {
		return 0;
	}
	if (key === "End") {
		return count - 1;
	}
	if (key === "ArrowLeft") {
		return (current + count - 1) % count;
	}
	if (key === "ArrowRight") {
		return (current + 1) % count;
	}
	return current;
}

export function Tab(props: {
	tabs: TabItemOption[];
	activeIndex?: number;
}): JSX.Element {
	const [activeIndex, setActiveIndex] = useState(() =>
		resolveTabIndex(props.activeIndex || 0, "", props.tabs.length)
	);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

	const selectTab = (index: number) => {
		setActiveIndex(index);
		props.tabs[index]?.onClick?.();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		const nextIndex = resolveTabIndex(
			activeIndex,
			event.key,
			props.tabs.length
		);
		if (nextIndex === activeIndex && !["Home", "End"].includes(event.key)) {
			return;
		}
		event.preventDefault();
		selectTab(nextIndex);
		tabRefs.current[nextIndex]?.focus();
	};

	return (
		<div className="tab-container">
			<div className="tab-titles" role="tablist" aria-orientation="horizontal">
				{props.tabs.map((tab, index) => {
					const tabId = getTabId(index, instanceId);
					const panelId = getTabPanelId(index, instanceId);
					return (
						<TabTitle
							key={tabId}
							id={tabId}
							panelId={panelId}
							active={index === activeIndex}
							tabIndex={index === activeIndex ? 0 : -1}
							{...tab}
							onClick={() => selectTab(index)}
							onKeyDown={handleKeyDown}
							ref={(element) => {
								tabRefs.current[index] = element;
							}}
						/>
					);
				})}
			</div>
			<div className="tab-items">
				{props.tabs.map((tab, index) => (
					<TabItem
						key={getTabPanelId(index, instanceId)}
						id={getTabPanelId(index, instanceId)}
						labelledBy={getTabId(index, instanceId)}
						title={tab.title}
						icon={tab.icon}
						active={index === activeIndex}
					>
						{tab.children}
					</TabItem>
				))}
			</div>
		</div>
	);
}

export const TabTitle = forwardRef<HTMLButtonElement, {
	title: string;
	icon?: ReactNode;
	children?: ReactNode;
	active?: boolean;
	onClick?: () => void;
	onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
	id?: string;
	panelId?: string;
	tabIndex?: number;
}>((props, ref): JSX.Element => {
	const { title, icon, active } = props;
	return (
		<button
			ref={ref}
			type="button"
			role="tab"
			id={props.id}
			aria-controls={props.panelId}
			aria-selected={active === true}
			tabIndex={props.tabIndex ?? (active ? 0 : -1)}
			className={`tab-item-title ${active ? "active" : ""}`}
			onClick={() => props.onClick?.()}
			onKeyDown={props.onKeyDown}
		>
			{icon && <span aria-hidden="true">{icon}</span>}
			<span>{title}</span>
		</button>
	);
});

export function TabItem(props: {
	title: string;
	icon?: ReactNode;
	children?: ReactNode;
	active?: boolean;
	onClick?: () => void;
	id?: string;
	labelledBy?: string;
}): JSX.Element {
	const { children, active } = props;
	return (
		<div
			id={props.id}
			role="tabpanel"
			aria-labelledby={props.labelledBy}
			hidden={!active}
			className={`tab-item ${active ? "active" : ""}`}
			onClick={() => props.onClick?.()}
		>
			<div className="tab-item-content">{children}</div>
		</div>
	);
}

export interface TabItemOption {
	title: string;
	icon?: ReactNode;
	children?: ReactNode;
	onClick?: () => void;
}
