import { cp, readdir, readFile, rm, writeFile } from "fs/promises";
import { isAbsolute, join, relative, sep } from "path";
import { Command } from "../command";
import {
    ADDON_PATHS,
    COMMUNITY_PATH,
    COMMUNITY_ROOT_PATH,
    ENTERPRISE_PATH,
    ENTERPRISE_ROOT_PATH,
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

// `rootPath` is the current (possibly version-worktree) directory. `installPath` is the true repo
// checkout root, shared by every worktree of that repo.
//
// Only the actual node packages (node_modules, package.json, lock file) move to `installPath`:
// bun/npm/ESLint's plugin & config resolution all walk up parent directories to find them, so a
// single shared copy is enough and avoids the duplicate-`node_modules` plugin-resolution conflict
// a per-worktree install causes (two physically different copies of the same plugin).
//
// Everything else stays at `rootPath` because it does NOT resolve by walking up: `jsconfig.json`'s
// paths depend on this worktree's own nesting; `.eslintignore` is only ever read from ESLint's own
// CWD, never inherited from a parent directory; and git's `core.hooksPath` is resolved against
// each worktree's own top-level directory, so `.hooks` must physically exist in every worktree for
// commits made there to run it. `.eslintrc.json` would technically cascade fine from a single
// shared copy, but is kept alongside the other config for consistency.
// Per-worktree cleanup only — leaves the shared node packages at `installPath` untouched, so a
// `reload` (which tears down and rebuilds the per-worktree config when switching worktrees, or
// after the templates change) never forces a reinstall of packages that haven't changed.
async function _disableWorktree(rootPath: string) {
    // Disable git hooks
    await $`cd ${rootPath} && git config --unset core.hooksPath &2> /dev/null`;

    await Promise.all([
        remove(join(rootPath, ".eslintignore")),
        remove(join(rootPath, ".eslintrc.json")),
        remove(join(rootPath, "jsconfig.json")),
        remove(join(rootPath, HOOKS_FOLDER), { recursive: true }),
    ]);
}

// Tears down the shared node packages themselves — only meant for a full opt-out (`disable`), not
// for `reload`, since every worktree of a repo shares this same install.
async function _disableShared(installPath: string) {
    await Promise.all([
        remove(join(installPath, "package.json")),
        remove(join(installPath, jsLockFile)),
        remove(join(installPath, "node_modules"), { recursive: true }),
    ]);
}

async function _disable(rootPath: string, installPath: string) {
    await Promise.all([_disableWorktree(rootPath), _disableShared(installPath)]);
}

async function _enable(rootPath: string, installPath: string) {
    await Promise.all([
        // Per-worktree config
        copy(join(TOOLING_PATH, "_eslintignore"), join(rootPath, ".eslintignore")),
        copy(join(TOOLING_PATH, "_eslintrc.json"), join(rootPath, ".eslintrc.json")),
        ensureDirectory(join(rootPath, HOOKS_FOLDER)).then(() =>
            copy(HOOKS_PATH, join(rootPath, HOOKS_FOLDER), { recursive: true })
        ),
        // Shared node package manifest
        copy(join(TOOLING_PATH, "_package.json"), join(installPath, "package.json")),
    ]);
    await writeJsConfig(rootPath, join(TOOLING_PATH, "_jsconfig.json"));

    // Setup git hooks
    await $`cd ${rootPath} && git config core.hooksPath ${HOOKS_FOLDER} &2>/dev/null`;

    // Install dependencies once, shared by every worktree. The lock file is left in place
    // afterwards (not just the `node_modules` it produces) so a later `enable`/`reload` from
    // another worktree reuses it instead of re-resolving/re-installing from scratch.
    await $`cd ${installPath} && ${jsRuntime} install`;
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
                await Promise.all([
                    _disable(COMMUNITY_PATH, COMMUNITY_ROOT_PATH),
                    _disable(ENTERPRISE_PATH, ENTERPRISE_ROOT_PATH),
                ]);
                logger.info("Tooling disabled.");
                break;
            }
            case "enable": {
                await Promise.all([
                    _enable(COMMUNITY_PATH, COMMUNITY_ROOT_PATH),
                    _enable(ENTERPRISE_PATH, ENTERPRISE_ROOT_PATH),
                ]);
                logger.info("Tooling enabled.");
                break;
            }
            default: {
                // Only the per-worktree config is torn down and rebuilt here — the shared node
                // packages at the install root are left alone (see `_disableWorktree`), so
                // reloading tooling in a different worktree of the same repo doesn't force a
                // reinstall of packages that haven't changed.
                await Promise.all([_disableWorktree(COMMUNITY_PATH), _disableWorktree(ENTERPRISE_PATH)]);
                await Promise.all([
                    _enable(COMMUNITY_PATH, COMMUNITY_ROOT_PATH),
                    _enable(ENTERPRISE_PATH, ENTERPRISE_ROOT_PATH),
                ]);
                logger.info("Tooling reloaded.");
                break;
            }
        }
    },
    help: ["Toggle JavaScript tooling."],
});
