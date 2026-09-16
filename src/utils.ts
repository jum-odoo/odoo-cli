import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { Command } from "./command";
import {
    ADDON_PACKS,
    ADDON_PATHS,
    BIN_PATH,
    LOCAL_HOST,
    LOCALE,
    LocalError,
    MANIFEST_FILE_NAME,
    RE_ODOO_VERSION,
    RE_VALID_MODULE_NAME,
} from "./constants";
import { HIGHLIGHT, type Highlighter, logger } from "./logger";
import { $, spawnProcess } from "./process";

const { brightBlue, brightRed, brightYellow } = HIGHLIGHT;

async function getPathModules(path: string) {
    const pathModules: Set<string> = new Set();
    const items = await readdir(path);
    await Promise.all(
        mapped(items, async (item) => {
            if (!RE_VALID_MODULE_NAME.test(item)) {
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
    return sorted(pathModules);
}

async function getValidAddons() {
    if (!registeredModules.size) {
        await Promise.all(
            mapped(Object.values(ADDON_PATHS), async (path) => {
                for (const module of await getPathModules(path)) {
                    registeredModules.add(module);
                }
            })
        );
    }
    return registeredModules;
}

// Weights used in the Levenshtein matrix
const LVD_REPLACE: number = 1.5;
const LVD_INSERT: number = 1;
const LVD_DELETE: number = 1;

const RE_WILD_CARD = /\*+/g;
const RE_WHITE_SPACE = /\s+/g;

const andFormatter = new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" });
const orFormatter = new Intl.ListFormat(LOCALE, { style: "long", type: "disjunction" });
const registeredModules: Set<string> = new Set();

export function and(iterable: Iterable<string>, mapFn?: (item: string) => string) {
    return andFormatter.format(mapFn ? mapped(iterable, mapFn) : iterable);
}

export function asyncMemoize<T>(getter: () => PromiseLike<T>) {
    let value: T;
    let called = false;
    return async function asyncMemoized() {
        if (!called) {
            called = true;
            value = await getter();
        }
        return value;
    };
}

export function* concat<T>(...iterables: Iterable<T>[]) {
    for (const iterable of iterables) {
        yield* iterable;
    }
}

export async function dropDatabase(command: Command) {
    await Promise.all(
        mapped(command.getOptionValues("database"), (dbName) =>
            $`dropdb -f ${dbName}`.catch(warnError)
        )
    );
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

export async function fileExists(path: string) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export function* filtered<T>(iterable: Iterable<T>, filterFn: (item: T) => any) {
    for (const item of iterable) {
        if (filterFn(item)) {
            yield item;
        }
    }
}

export function formatError(error: Error | string | null) {
    let message: string;
    if (error instanceof Error) {
        message = String(error.message);
    } else {
        message = String(error ?? "error");
    }
    return [
        ...filtered(
            mapped(filtered(message.split("\n"), Boolean), (line) => {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith("Command failed:")) {
                    return "";
                } else {
                    return trimmedLine.replaceAll(RE_WHITE_SPACE, " ");
                }
            }),
            Boolean
        ),
    ].join("\n");
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
    const baseMessage = `unknown ${label}: ${and(terms, brightRed)}.`;
    if (!closests.size) {
        return baseMessage;
    }
    const suggestions = [];
    for (const closest of closests) {
        suggestions.push(suggestionColor(closest));
    }
    return baseMessage + ` Did you mean ${or(suggestions)}?`;
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

export function* flatMapped<T, K>(iterable: Iterable<T>, mapFn: (item: T) => K | Iterable<K>) {
    for (const item of iterable) {
        const result = mapFn(item);
        if ((result as any)?.[Symbol.iterator]) {
            yield* result as any as Iterable<K>;
        } else {
            yield result as K;
        }
    }
}

export function* mapped<T, K>(iterable: Iterable<T>, mapFn: (item: T) => K) {
    for (const item of iterable) {
        yield mapFn(item);
    }
}

export function memoize<T>(getter: () => T) {
    let value: T;
    let called = false;
    return function memoized() {
        if (!called) {
            called = true;
            value = getter();
        }
        return value;
    };
}

export function or(iterable: Iterable<string>, mapFn?: (item: string) => string) {
    return orFormatter.format(mapFn ? mapped(iterable, mapFn) : iterable);
}

export async function parseAddons(addonsOptionValues: Iterable<string>) {
    const addons = new Set<string>();
    const invalidAddons: string[] = [];
    const noMatchesAddons: string[] = [];
    const validAddons = await getValidAddons();
    const addonValues = [...addonsOptionValues].flatMap((v) => v.trim().split(/\s*,\s*/g));
    for (const addon of addonValues) {
        if (addon === "all") {
            for (const validAddon of filtered(
                validAddons,
                (addon) => !addon.startsWith("l10n_") || addon.startsWith("l10n_be")
            )) {
                addons.add(validAddon);
            }
            continue;
        }
        if (addon in ADDON_PACKS) {
            for (const packAddon of ADDON_PACKS[addon]) {
                addons.add(packAddon);
            }
        } else if (RE_WILD_CARD.test(addon)) {
            const regex = new RegExp(`^${addon.replaceAll(RE_WILD_CARD, ".*")}$`);
            let matchFound = false;
            for (const foundAddon of filtered(validAddons, (validAddon) =>
                regex.test(validAddon)
            )) {
                matchFound ||= true;
                addons.add(foundAddon);
            }
            if (!matchFound) {
                noMatchesAddons.push(addon);
            }
        } else if (validAddons.has(addon)) {
            addons.add(addon);
        } else {
            invalidAddons.push(addon);
        }
    }
    const errors = [];
    if (noMatchesAddons.length) {
        errors.push(`no addons found matching: ${or(noMatchesAddons, brightRed)}`);
    }
    if (invalidAddons.length) {
        errors.push(
            getErrorMessageWithHelp(
                plural("addon", invalidAddons),
                invalidAddons,
                concat(Object.keys(ADDON_PACKS), validAddons),
                brightYellow
            )
        );
    }
    if (errors.length) {
        throw new LocalError(and(errors));
    }
    return addons;
}

export function plural(word: string, count: number | any[], suffix = "s") {
    if (Array.isArray(count)) {
        count = count.length;
    }
    return count === 1 ? word : word + suffix;
}

export function sorted<T>(iterable: Iterable<T>, property?: keyof T) {
    const list = Array.isArray(iterable) ? (iterable as T[]) : [...iterable];
    return list.sort((a, b) => {
        const _a = String(property ? a[property] : a);
        const _b = String(property ? b[property] : b);
        return _a.localeCompare(_b);
    });
}

export async function startServer(command: Command, args: string[]) {
    const serverPromise = spawnProcess(["python3", BIN_PATH, ...args]).catch(warnError);
    const [port] = command.getOptionValues("http-port");
    if (command.hasOption("open")) {
        await $`open ${LOCAL_HOST}:${port}/web?debug=assets`;
    }
    await serverPromise;
}

export async function startServerFromCommand(command: Command, args: string[]) {
    const dbName = command.getOptionValues("database").join(" ");
    const version = await getOdooVersion();
    let message = `Starting database ${brightYellow(dbName)}`;
    if (version !== dbName) {
        message += ` (Odoo version ${brightBlue(version)})`;
    }
    logger.info(message + ".");
    return startServer(command, args);
}

export function warnError(error: any) {
    return logger.warn(formatError(error));
}

export async function withDemoData(this: Command) {
    const version = await getOdooVersion();
    if (version !== "master") {
        // Extract the major version number regardless of a "saas-" prefix
        // (e.g. "saas-19.1" -> 19), rather than choking on the leading "saas".
        const match = version?.match(RE_ODOO_VERSION);
        const nVersion = match?.groups?.number ? Number(match.groups.number.split(".")[0]) : 0;
        if (!nVersion || nVersion < 19) {
            // With <19 or unrecognized version: use "without-demo" (legacy)
            return ["--without-demo=False"];
        }
    }
    // With master or >=19: use "with-demo"
    return ["--with-demo"];
}

export const getOdooVersion = asyncMemoize(async () => {
    const fullVersion = await $`${BIN_PATH} --version`;
    const match = fullVersion.match(RE_ODOO_VERSION);
    const versionNumber = match?.groups?.number;
    if (!versionNumber) {
        return fullVersion;
    }
    return versionNumber.endsWith(".0") ? versionNumber : `saas-${versionNumber}`;
});
