import { copyFile } from "node:fs/promises";
import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
    failOnWarn: false,
    hooks: {
        "build:done": async () => {
            console.log("Copying main.css to dist/main.css");
            await copyFile("src/main.css", "dist/main.css");
        },
    },
});
