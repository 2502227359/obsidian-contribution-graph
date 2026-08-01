import { App, MarkdownView, Notice, getIcon } from "obsidian";
import { ContributionGraphCreateModal } from "../form/GraphFormModal";
import { EditActivityService } from "src/activity/EditActivityService";
import { Locals } from "src/i18/messages";

export function mountEditButtonToCodeblock(
	app: App,
	activityService: EditActivityService,
	code: string,
	codeblockDom: HTMLElement
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
		new ContributionGraphCreateModal(
			app,
			activityService,
			code,
			(content) => {
				const markdownView =
					app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) {
					new Notice("No markdown view is active");
					return;
				}
				const editor = markdownView.editor;
				// @ts-ignore
				const editorView = editor.cm as EditorView;
				const pos = editorView.posAtDOM(codeblockDom);
				const start = pos + "```contributionGraph\n".length;
				// set selection
				editorView.dispatch({
					changes: {
						from: start,
						to: start + (code ? code.length : 0),
						insert: content,
					},
				});
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
