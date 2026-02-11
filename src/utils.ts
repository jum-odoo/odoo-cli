import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { type Command } from "./command";
import {
    ADDON_PACKS,
    ADDON_PATHS,
    BIN_PATH,
    COMMUNITY_PATH,
    LOCAL_HOST,
    LocalError,
    MANIFEST_FILE_NAME,
    R_VALID_MODULE_NAME,
} from "./constants";
import { HIGHLIGHT, type Highlighter, logger } from "./logger";
import { $, spawnProcess } from "./process";

const { brightMagenta, brightYellow, brightRed } = HIGHLIGHT;

export type Resolver<T> = T | (() => T | PromiseLike<T>);

function getCsrfTokenFromHtml(html: string) {
    const match = html.match(R_CSRF_TOKEN);
    return match?.groups?.token || null;
}

async function getPathModules(path: string) {
    const pathModules: Set<string> = new Set();
    const items = await readdir(path);
    await Promise.all(
        items.map(async (item) => {
            if (!R_VALID_MODULE_NAME.test(item)) {
                return; // invalid module name
            }
            const fullItemPath = join(path, item);
            const itemStat = await stat(fullItemPath);
            if (!itemStat.isDirectory()) {
                return; // not a directory
            }
            const itemContent = await readdir(fullItemPath);
            if (!itemContent.includes(MANIFEST_FILE_NAME)) {
                return; // no manifest
            }
            pathModules.add(item);
        })
    );
    return [...pathModules].sort();
}

async function getValidAddons() {
    let values = Object.values(registeredModules);
    if (!values.length) {
        await Promise.all(
            Object.values(ADDON_PATHS).map(async (path) => {
                registeredModules[path] = await getPathModules(path);
            })
        );
        values = Object.values(registeredModules);
    }
    return values.flat();
}

// Weights used in the Levenshtein matrix
const LVD_REPLACE: number = 1.5;
const LVD_INSERT: number = 1;
const LVD_DELETE: number = 1;

const R_BRANCH_DATABASE = /^(\d+\.\d|saas-\d+\.\d|master)/;
const R_CSRF_TOKEN = /csrf_token\s*:\s*['"`](?<token>\w+)['"`]/im;
const R_WHITE_SPACE = /\s+/g;

const registeredModules: Record<string, string[]> = Object.create(null);

export async function dropDatabase(command: Command, args: string[]) {
    const dbNames = command.options.database.values;
    await Promise.all(dbNames.map((dbName) => $`dropdb -f ${dbName}`.catch(warnError)));
}

export async function ensureDirectory(path: string) {
    try {
        await access(path);
    } catch {
        await mkdir(path);
    }
}

export async function ensureFile(path: string, callback: () => string | Promise<string>) {
    try {
        await readFile(path, "utf-8");
    } catch {
        const content = await callback();
        await writeFile(path, content, "utf-8");
    }
}

export function formatError(error: Error | string | null) {
    let message: string;
    if (error instanceof Error) {
        message = String(error.message);
    } else {
        message = String(error ?? "error");
    }
    return message
        .split("\n")
        .map((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith("Command failed:")) {
                return "";
            } else {
                return trimmedLine.replaceAll(R_WHITE_SPACE, " ");
            }
        })
        .filter(Boolean)
        .join("\n");
}

export function getErrorMessageWithHelp(
    label: string,
    terms: string[],
    availableTerms: Iterable<string>,
    suggestionColor: Highlighter
) {
    const closests = new Set<string>();
    let closestDistance = 2;
    for (const term of terms) {
        for (const existingName of availableTerms) {
            const distance = levenshtein(term, existingName);
            if (distance > closestDistance) {
                continue;
            }
            if (distance < closestDistance) {
                closestDistance = distance;
                closests.clear();
            }
            closests.add(existingName);
        }
    }
    const baseMessage = `unknown ${label}: ${terms.map((t) => brightRed(t)).join(", ")}.`;
    if (!closests.size) {
        return baseMessage;
    }
    const suggestions = [];
    for (const closest of closests) {
        suggestions.push(suggestionColor(closest));
    }
    return baseMessage + ` Did you mean ${suggestions.join(" or ")}?`;
}

export const levenshtein = (a: string, b: string): number => {
    // One of the strings is empty => requires otherstring.length mutations
    if (!a.length || !b.length) {
        return (b || a).length;
    }
    if (a === b) {
        return 0;
    }
    const matrix: number[][] = [];
    // Assign first row and column
    for (let row = 0; row <= a.length; matrix[row] = [row++]);
    for (let col = 0; col <= b.length; matrix[0][col] = col++);
    // Fills the rest of the matrix
    for (let row = 1; row <= a.length; row++) {
        for (let col = 1; col <= b.length; col++) {
            matrix[row][col] =
                a[row - 1] === b[col - 1]
                    ? matrix[row - 1][col - 1]
                    : Math.min(
                          matrix[row - 1][col - 1] + LVD_REPLACE,
                          matrix[row][col - 1] + LVD_INSERT,
                          matrix[row - 1][col] + LVD_DELETE
                      );
        }
    }
    // Minimal distance is the last element
    return matrix[a.length][b.length];
};

export async function parseAddons(addonsValue: string[]) {
    const addons: string[] = [];
    const invalidAddons = [];
    const validAddons = await getValidAddons();
    for (const addon of addonsValue.flatMap((v) => v.trim().split(/\s*,\s*/g))) {
        if (addon === "all") {
            return validAddons.filter(
                (addon) => !addon.startsWith("l10n_") || addon.startsWith("l10n_be")
            );
        }
        const addedModules = addon in ADDON_PACKS ? ADDON_PACKS[addon] : [addon];
        for (const addon of addedModules) {
            if (validAddons.includes(addon)) {
                addons.push(addon);
            } else {
                invalidAddons.push(addon);
            }
        }
    }
    if (invalidAddons.length) {
        const errorMessage = getErrorMessageWithHelp(
            "addons",
            invalidAddons,
            validAddons,
            brightYellow
        );
        throw new LocalError(errorMessage);
    }
    return addons;
}

export function plural(word: string, count: number, suffix = "s") {
    return count === 1 ? word : word + suffix;
}

export function resolve<T>(value: Resolver<T>): T | Promise<T> {
    return typeof value === "function" ? (value as () => T | Promise<T>)() : value;
}

export async function startServer(command: Command, args: string[]) {
    spawnProcess(["python3", BIN_PATH, ...args]);
    const [port] = command.options["http-port"].values || [];
    // TODO: not working :(
    // if (command.options.login) {
    //     const login = command.options.login.values.join(" ");
    //     setTimeout(async () => {
    //         const getResponse = await fetch(`${LOCAL_HOST}:${port}/web/login`, { method: "GET" });
    //         const text = await getResponse.text();
    //         const csrfToken = getCsrfTokenFromHtml(text);
    //         const data = new FormData();
    //         data.set("login", login);
    //         data.set("password", login);
    //         data.set("csrf_token", csrfToken);
    //         data.set("type", "password");
    //         data.set("redirect", "/odoo");
    //         logger.debug("Sending login request with:", Object.fromEntries(data.entries()));
    //         const postResponse = await fetch(`${LOCAL_HOST}:${port}/web/login`, {
    //             method: "POST",
    //             body: data,
    //             headers: getResponse.headers,
    //         });
    //         logger.info(postResponse);
    //     }, 1000);
    // }
    if (command.options.open) {
        await $`open ${LOCAL_HOST}:${port}/web?debug=assets`;
    }
}

export async function startServerFromCommand(command: Command, args: string[]) {
    const dbName = command.options.database.values.join(" ");
    logger.info(`starting database ${brightYellow(dbName)}`);
    startServer(command, args);
}

export async function getDefaultDbName() {
    const branch = await $`cd ${COMMUNITY_PATH} && git rev-parse --abbrev-ref HEAD`;
    return [branch.match(R_BRANCH_DATABASE)?.[1] || "dev"];
}

export function warnError(error: any) {
    return logger.warn(formatError(error));
}
