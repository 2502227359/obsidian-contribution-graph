import { Locals } from "src/i18/messages";
import "./index.css";

export function About() {
	const local = Locals.get();
	return (
		<div className="about-container">
			<div className="about-item">
				<div className="label">{local.form_local_edition}</div>
				<div>{local.form_local_edition_description}</div>
			</div>
		</div>
	);
}
