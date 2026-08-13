import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	getIcon,
} from "obsidian";
import { ContributionGraphCreateModal } from "../form/GraphFormModal";
import { EditActivityService } from "src/activity/EditActivityService";
import { Locals } from "src/i18/messages";
import { createCodeblockYamlEdit } from "./codeblockSource";

export function mountEditButtonToCodeblock(
	app: App,
	activityService: EditActivityService,
	code: string,
	codeblockDom: HTMLElement,
	renderedEl: HTMLElement,
	ctx: MarkdownPostProcessorContext
) {
	const existingButton = codeblockDom.querySelector<HTMLElement>(
		":scope > .contribution-graph-codeblock-edit-button"
	);
	if (existingButton) {
		return existingButton;
	}

	codeblockDom.classList.add("contribution-graph-codeblock-host");
	const formEditButton = document.createElement("button");
	formEditButton.type = "button";
	formEditButton.className = "contribution-graph-codeblock-edit-button";
	formEditButton.setAttribute("aria-label", Locals.get().codeblock_edit_graph);
	formEditButton.title = Locals.get().codeblock_edit_graph;

	const iconEl = getIcon("settings");
	if (iconEl) {
		formEditButton.appendChild(iconEl);
	} else {
		const fallback = document.createElement("span");
		fallback.className = "contribution-graph-codeblock-edit-button-fallback";
		fallback.textContent = "⚙";
		fallback.setAttribute("aria-hidden", "true");
		formEditButton.appendChild(fallback);
	}
	justifyTop(codeblockDom, formEditButton);

	formEditButton.onclick = (event) => {
		event.preventDefault();
		event.stopPropagation();
		const sourceView = app.workspace.getActiveViewOfType(MarkdownView);
		if (!sourceView || sourceView.file?.path !== ctx.sourcePath) {
			new Notice(Locals.get().codeblock_edit_unavailable);
			return;
		}
		new ContributionGraphCreateModal(
			app,
			activityService,
			code,
			(content) => {
				if (sourceView.file?.path !== ctx.sourcePath) {
					new Notice(Locals.get().codeblock_edit_unavailable);
					return;
				}
				const section = ctx.getSectionInfo(renderedEl);
				const edit = section
					? createCodeblockYamlEdit(
							(line) => sourceView.editor.getLine(line),
							section,
							content
					  )
					: undefined;
				if (!edit) {
					new Notice(Locals.get().codeblock_edit_unavailable);
					return;
				}
				sourceView.editor.replaceRange(
					edit.insert,
					edit.from,
					edit.to
				);
			}
		).open();
	};
	codeblockDom.appendChild(formEditButton);
	return formEditButton;
}

function justifyTop(codeblockDom: HTMLElement, formEditButton: HTMLButtonElement) {
	const obCodeblocButtonEls =
		codeblockDom.getElementsByClassName("edit-block-button");
	if (obCodeblocButtonEls.length > 0) {
		const top = window.getComputedStyle(obCodeblocButtonEls[0]).top;
		if (top && top !== "auto") {
			formEditButton.style.top = top;
		}
	}
}
