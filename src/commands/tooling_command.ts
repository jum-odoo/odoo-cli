import { cp, readdir, readFile, rm, writeFile } from "fs/promises";
import { isAbsolute, join, relative, sep } from "path";
import { Command } from "../command";
import {
    ADDON_PATHS,
    COMMUNITY_PATH,
    ENTERPRISE_PATH,
    MANIFEST_FILE_NAME,
    SRC_PATH,
} from "../constants";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import { ensureDirectory, fileExists, filtered, mapped, sorted } from "../utils";

const { brightGreen, brightYellow } = HIGHLIGHT;

function catchMissingFile<T extends (...args: any[]) => PromiseLike<any>>(fn: T) {
    return async function (...args: Parameters<T>) {
        try {
            await fn(...args);
        } catch (err: any) {
            // Ignore "file missing" errors
            if (err?.code !== "ENOENT") {
                throw err;
            }
        }
    };
}

async function getWorktreePaths(rootPath: string) {
    const worktreeList = await $`cd ${rootPath} && git worktree list --porcelain`;
    const worktreePaths: string[] = [];
    for (const line of worktreeList.split("\n")) {
        if (!line.startsWith("worktree ")) {
            continue;
        }
        const worktreePath = line.slice("worktree ".length).trim();
        const relativePath = relative(rootPath, worktreePath);
        if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
            worktreePaths.push(relativePath.split(sep).join("/"));
        }
    }
    return worktreePaths;
}

async function writeJsConfig(rootPath: string, source: string) {
    function formatRoots(object: any, key: string) {
        const initialList: string[] | undefined = object[key];
        if (!initialList) {
            return;
        }
        const list: string[] = [];
        for (const path of initialList) {
            const [prefix, ...pathParts] = path.split(sep);
            if (prefix === "addons") {
                list.push(join(relativeCommunity, ...pathParts));
            } else {
                list.push(path);
            }
        }
        object[key] = list;
    }

    async function gatherPath(path: string) {
        const [manifestExists, srcExists] = await Promise.all([
            fileExists(join(path, MANIFEST_FILE_NAME)),
            fileExists(join(path, SRC_PATH)),
        ]);
        // Skip addons with no '__manifest__.py' or 'static/src'
        if (manifestExists && srcExists) {
            pathEntries.push([
                join(`@${path.split(sep).at(-1)}`, "*"),
                [join(relative(rootPath, path), SRC_PATH, "*")],
            ]);
        }
    }

    async function gatherPaths(path: string) {
        const items = await readdir(path);
        await Promise.all(mapped(items, (item) => gatherPath(join(path, item))));
    }

    const destination = join(rootPath, "jsconfig.json");
    const file = await readFile(source, "utf-8");
    const config = JSON.parse(file);
    config.compilerOptions ||= {};
    config.compilerOptions.baseUrl ||= ".";
    config.exclude ||= [];
    config.exclude = config.exclude.map((exclude: string) => {
        if (exclude === "**/l10n*") {
            // Correct the 'l10n*' blanket exclude to only match 'l10n_*' addons
            // (otherwise it will exclude the '@web/core/l10n/' folder).
            return "**/l10n_*";
        }
        return exclude;
    });
    for (const worktreePath of await getWorktreePaths(rootPath)) {
        if (!config.exclude.includes(worktreePath)) {
            config.exclude.push(worktreePath);
        }
    }
    const relativeCommunity = relative(rootPath, ADDON_PATHS.community);
    const relativeEnterprise = relative(rootPath, ADDON_PATHS.enterprise);

    // Paths
    const pathEntries: [string, string[]][] = [];
    await Promise.all([gatherPaths(ADDON_PATHS.community), gatherPaths(ADDON_PATHS.enterprise)]);
    config.compilerOptions.paths = Object.fromEntries(sorted(pathEntries, 0));

    formatRoots(config.compilerOptions, "typeRoots");
    config.compilerOptions.typeRoots = [
        join(relativeCommunity, "*", SRC_PATH, "**", "@types"),
        join(relativeEnterprise, "*", SRC_PATH, "**", "@types"),
        ...filtered(config.compilerOptions.typeRoots, (root: string) => !root.startsWith("*")),
    ];
    formatRoots(config, "exclude");
    formatRoots(config, "include");

    await writeFile(destination, JSON.stringify(config, null, 4), "utf-8");
}

async function _disable(rootPath: string) {
    // Disable git hooks
    await $`cd ${rootPath} && git config --unset core.hooksPath &2> /dev/null`;

    // Remove all tooling files
    await Promise.all([
        remove(join(rootPath, ".eslintignore")),
        remove(join(rootPath, ".eslintrc.json")),
        remove(join(rootPath, "package.json")),
        remove(join(rootPath, jsLockFile)),
        remove(join(rootPath, "node_modules"), { recursive: true }),
        remove(join(rootPath, "jsconfig.json")),
        // Pre-commit hooks
        remove(join(rootPath, HOOKS_FOLDER), { recursive: true }),
    ]);
}

async function _enable(rootPath: string) {
    // Copy tooling files
    await Promise.all([
        copy(join(TOOLING_PATH, "_eslintignore"), join(rootPath, ".eslintignore")),
        copy(join(TOOLING_PATH, "_eslintrc.json"), join(rootPath, ".eslintrc.json")),
        copy(join(TOOLING_PATH, "_package.json"), join(rootPath, "package.json")),
        writeJsConfig(rootPath, join(TOOLING_PATH, "_jsconfig.json")),
        // Pre-commit hooks
        ensureDirectory(join(rootPath, HOOKS_FOLDER)).then(() =>
            copy(HOOKS_PATH, join(rootPath, HOOKS_FOLDER), { recursive: true })
        ),
    ]);

    // Setup git hooks
    await $`cd ${rootPath} && git config core.hooksPath ${HOOKS_FOLDER} &2>/dev/null`;

    // Install dependencies
    const jsLockPath = join(rootPath, jsLockFile);
    const lockFileExists = await fileExists(jsLockPath);
    try {
        await $`cd ${rootPath} && ${jsRuntime} install`;
    } catch (err: any) {
        if (!String(err).includes("Resolved")) {
            throw err;
        }
    }
    if (!lockFileExists) {
        // Remove .lock file if it did not exist already, to avoid useless diff
        await remove(jsLockPath);
    }
}

const copy = catchMissingFile(cp);
const remove = catchMissingFile(rm);

const TOOLING_PATH = join(ADDON_PATHS.community, "web", "tooling");
const HOOKS_PATH = join(__dirname, "..", "..", "hooks");
const HOOKS_FOLDER = ".hooks";

let jsRuntime = "bun";
let jsLockFile = "bun.lock";

Command.register({
    name: "tooling",
    options: [
        {
            action: {
                required: true,
                help: [
                    "Action to perform:",
                    [
                        `• ${brightYellow`enable`}: enable the tooling on all directories;`,
                        `• ${brightYellow`disable`}: disable the tooling from all directories;`,
                        `• ${brightYellow`reload`}: disable then re-enable tooling on all directories.`,
                    ],
                ],
            },
            manager: {
                defaultValues: ["bun"],
                help: [
                    `JavaScript package manager: either ${brightGreen`bun`} or ${brightGreen`npm`}`,
                ],
            },
        },
    ],
    parameters: {
        name: "action",
        optionName: "action",
    },
    async handler() {
        const action = this.getOptionValues("action").join(" ");
        switch (this.getOptionValues("manager")[0]) {
            case "bun": {
                jsRuntime = "bun";
                jsLockFile = "bun.lock";
                break;
            }
            case "npm": {
                jsRuntime = "npm";
                jsLockFile = "package.json";
                break;
            }
        }
        switch (action) {
            case "disable": {
                await Promise.all([_disable(COMMUNITY_PATH), _disable(ENTERPRISE_PATH)]);
                logger.info("Tooling disabled.");
                break;
            }
            case "enable": {
                await Promise.all([_enable(COMMUNITY_PATH), _enable(ENTERPRISE_PATH)]);
                logger.info("Tooling enabled.");
                break;
            }
            default: {
                await Promise.all([_disable(COMMUNITY_PATH), _disable(ENTERPRISE_PATH)]);
                await Promise.all([_enable(COMMUNITY_PATH), _enable(ENTERPRISE_PATH)]);
                logger.info("Tooling reloaded.");
                break;
            }
        }
    },
    help: ["Toggle JavaScript tooling."],
});
