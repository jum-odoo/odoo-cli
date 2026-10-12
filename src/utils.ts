import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { Command } from "./command";
import {
    ADDON_PACKS,
    ADDON_PATHS,
    BIN_PATH,
    COMMUNITY_PATH,
    CONFIG_PATH,
    DEFAULT_HTTP_PORT,
    LOCAL_HOST,
    LOCALE,
    LocalError,
    MANIFEST_FILE_NAME,
    RE_ODOO_VERSION,
    RE_VALID_MODULE_NAME,
} from "./constants";
import { HIGHLIGHT, type Highlighter, logger } from "./logger";
import { $, evalPython, spawnProcess } from "./process";

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
    const dbNames = await getEffectiveDatabase(command);
    await Promise.all(mapped(dbNames, (dbName) => $`dropdb -f ${dbName}`.catch(warnError)));
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
    if (command.hasOption("open")) {
        const port = await getEffectiveHttpPort(command);
        await $`open ${LOCAL_HOST}:${port}/web?debug=assets`;
    }
    await serverPromise;
}

export async function startServerFromCommand(command: Command, args: string[]) {
    const dbName = (await getEffectiveDatabase(command)).join(" ");
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

export interface OdooBinOptionInfo {
    /** All long flag spellings (e.g. `["--stop", "--stop-after-init"]`), each already `--`-prefixed. */
    long: string[];
    /** All short flag spellings (e.g. `["-i"]`), each already `-`-prefixed. Usually at most one. */
    short: string[];
    /** Whether the option takes a value (vs. a plain boolean/store_true-style flag). */
    takesValue: boolean;
    help: string;
    metavar: string;
}

/**
 * Introspects odoo-bin's own `optparse` option parser (`odoo.tools.config`) directly through
 * Python, rather than hard-coding or regex-scraping its `--help` text: `odoo.tools.config.config`
 * is the same singleton `configmanager()` odoo-bin itself uses, already built (`self.parser =
 * self._build_cli()`) as soon as the module is imported, with no need to touch argv or a real
 * database. Options that odoo-bin itself hides from `--help` (`help=optparse.SUPPRESS_HELP`, used
 * for config-file-only settings) are skipped the same way odoo-bin's own formatter skips them, so
 * this always matches `odoo-bin server --help` exactly, for whichever version worktree is active.
 */
const ODOO_BIN_OPTIONS_SCRIPT = `
import json, optparse, sys
from odoo.tools.config import config

def _info(opt):
    if opt.help is None or opt.help == optparse.SUPPRESS_HELP:
        return None
    return {
        "short": list(opt._short_opts),
        "long": list(opt._long_opts),
        "metavar": opt.metavar or "",
        "help": opt.help,
        "takesValue": opt.takes_value(),
    }

options = []
for opt in config.parser.option_list:
    info = _info(opt)
    if info:
        options.append(info)
for group in config.parser.option_groups:
    for opt in group.option_list:
        info = _info(opt)
        if info:
            options.append(info)

json.dump(options, sys.stdout)
`.trim();

export const getOdooBinOptions = asyncMemoize(async (): Promise<OdooBinOptionInfo[]> => {
    try {
        const stdout = await evalPython(ODOO_BIN_OPTIONS_SCRIPT, {
            ...process.env,
            PYTHONPATH: COMMUNITY_PATH,
        });
        return JSON.parse(stdout);
    } catch (error) {
        logger.debug(formatError(error));
        logger.warn(
            `Could not import odoo from ${brightBlue(COMMUNITY_PATH)} to list its own options; showing only ${brightYellow`odoo-cli`}'s own options.`
        );
        return [];
    }
});

/** Greedily wraps `text` to `width` columns on word boundaries; used for odoo-bin's own help strings, which arrive as a single unwrapped paragraph. */
export function wrapText(text: string, width = 78): string[] {
    const words = text.replaceAll(RE_WHITE_SPACE, " ").trim().split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) {
        lines.push(line);
    }
    return lines;
}

function parseOdooConfig(content: string) {
    const values = new Map<string, string>();
    let inOptionsSection = false;
    for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith(";")) {
            continue;
        }
        const sectionMatch = line.match(/^\[(?<name>.+)\]$/);
        if (sectionMatch) {
            inOptionsSection = sectionMatch.groups?.name === "options";
            continue;
        }
        const eqIndex = line.indexOf("=");
        if (!inOptionsSection || eqIndex < 0) {
            continue;
        }
        values.set(line.slice(0, eqIndex).trim(), line.slice(eqIndex + 1).trim());
    }
    return values;
}

/** Reads this worktree's `odoo.conf` at most once per process; empty map if it doesn't exist yet. */
export const readOdooConfig = asyncMemoize(async () => {
    try {
        return parseOdooConfig(await readFile(CONFIG_PATH, "utf-8"));
    } catch {
        return new Map<string, string>();
    }
});

export async function getConfigValue(key: string) {
    return (await readOdooConfig()).get(key);
}

/**
 * Creates this worktree's `odoo.conf` with the defaults odoo-cli used to hardcode, if it doesn't
 * exist yet. Never overwrites an existing file, so manual customizations (e.g. a custom db_name)
 * are preserved.
 */
export async function ensureOdooConfig() {
    if (await fileExists(CONFIG_PATH)) {
        return;
    }
    const content = [
        "[options]",
        `db_name = ${await getOdooVersion()}`,
        `addons_path = ${Object.values(ADDON_PATHS).join(",")}`,
        `http_port = ${DEFAULT_HTTP_PORT}`,
        "dev_mode = all",
        "",
    ].join("\n");
    await writeFile(CONFIG_PATH, content, "utf-8");
}

/** The database name(s) that will actually be used: given `-d`, else odoo.conf's `db_name`, else the version. */
export async function getEffectiveDatabase(command: Command) {
    const values = command.getOptionValues("database");
    if (values.length) {
        return values;
    }
    const configured = await getConfigValue("db_name");
    if (configured) {
        return configured
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [await getOdooVersion()];
}

/** The HTTP port that will actually be used: given `-p`, else odoo.conf's `http_port`, else the default. */
export async function getEffectiveHttpPort(command: Command) {
    const [port] = command.getOptionValues("http-port");
    return port || (await getConfigValue("http_port")) || DEFAULT_HTTP_PORT;
}
