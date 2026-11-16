import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const manifest = JSON.parse(
	readFileSync(resolve(projectRoot, "manifest.json"), "utf8")
);
const packageJson = JSON.parse(
	readFileSync(resolve(projectRoot, "package.json"), "utf8")
);

if (manifest.version !== packageJson.version) {
	throw new Error(
		`Version mismatch: manifest ${manifest.version}, package ${packageJson.version}`
	);
}

const files = ["manifest.json", "main.js", "styles.css", "LICENSE", "THIRD-PARTY-NOTICES.txt"];
for (const file of files) {
	if (!existsSync(resolve(projectRoot, file))) {
		throw new Error(`Missing release file: ${file}`);
	}
}

const outputDir = resolve(projectRoot, "dist", manifest.id);
mkdirSync(outputDir, { recursive: true });
for (const file of files) {
	copyFileSync(resolve(projectRoot, file), resolve(outputDir, file));
}

const checksums = files
	.filter((file) => !["LICENSE", "THIRD-PARTY-NOTICES.txt"].includes(file))
	.map((file) => {
		const hash = createHash("sha256")
			.update(readFileSync(resolve(outputDir, file)))
			.digest("hex");
		return `${hash}  ${file}`;
	})
	.join("\n");
writeFileSync(resolve(outputDir, "SHA256SUMS.txt"), `${checksums}\n`);

console.log(
	`Packaged ${manifest.id} ${manifest.version} in ${outputDir}`
);
