import { createHash } from "crypto";
import { createReadStream, PathLike } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, sep } from "path";
import readline from "readline/promises";
import { Readable } from "stream";
import { Command } from "../command";
import { LocalError, R_NON_ALPHANUM } from "../constants";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";

const { brightBlue, brightCyan, cyan, yellow } = HIGHLIGHT;

interface MemoryData {
    isMobile: 0 | 1;
    source: number;
    // limit: number; // Limit is constant, so it's not really relevant
    suite: string;
    tests?: number;
    time: number;
    total: number;
    used: number;
}

interface MemoryDataSource {
    id: number;
    label: string;
    url: string;
    parent?: number;
}

async function editMemorySources(sourceFilePath: string) {
    const primaryEditor = await findEditor(SUPPORTED_PRIMARY_EDITORS);
    if (primaryEditor) {
        return $`${primaryEditor} ${sourceFilePath} --wait`;
    }

    const backupEditor = await findEditor(SUPPORTED_BACKUP_EDITORS);
    if (backupEditor) {
        return $`${backupEditor} ${sourceFilePath} --wait`;
    }

    throw new LocalError("no editor found on this system.");
}

function fetchSourceContents(sources: MemoryDataSource[]) {
    return Promise.all(
        sources.map(async (source): Promise<MemoryData[]> => {
            const { url } = source;
            let rStream: Readable;
            if (R_URL.test(url)) {
                // Fetch source from URL
                logger.debug(`Fetching memory logs from URL ${yellow(url)}`);
                let response = await fetch(url);
                if (!response.body) {
                    logger.warn(`No content found at URL ${yellow(url)}`);
                    return [];
                }
                if (response.headers.get("content-type")?.includes("text/html")) {
                    if (source.parent) {
                        logger.warn(
                            `Sub-sources in other sub-sources have been ignored: ${yellow(url)}`
                        );
                        return [];
                    }
                    const subSources = getSourcesFromHtml(source, await response.text());
                    logger.info(
                        `↳ ${brightBlue(source.label)}: parsing ${yellow(
                            subSources.length
                        )} memory data sub-sources`
                    );
                    const subSourceContents = await fetchSourceContents(subSources);
                    return subSourceContents.flat();
                }
                rStream = Readable.fromWeb(response.body);
            } else {
                // Fetch source from file
                logger.debug(`Reading memory logs from file ${cyan(url)}`);
                rStream = createReadStream(url, { encoding: "utf-8" });
            }
            return parseLogs(source, rStream);
        })
    );
}

function findEditor(editors: string[]) {
    return Promise.any(editors.map((editor) => $`${editor} --version`.then(() => editor))).catch(
        () => false
    );
}

async function getDataHash(path: PathLike) {
    const def = Promise.withResolvers();
    const stream = createReadStream(path, { encoding: "utf-8" });
    const reader = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
    });
    reader.on("error", () => def.resolve("null"));
    reader.on("line", (line) => def.resolve(line.replaceAll(R_NON_ALPHANUM, "")));
    return def.promise.finally(() => {
        reader.close();
        stream.close();
    });
}

function getSourceHash(sources: MemoryDataSource[]) {
    const hash = createHash("sha256");
    for (const { url } of sources) {
        hash.update(url);
    }
    return hash.digest("hex");
}

function getSourcesFromHtml(source: MemoryDataSource, body: string) {
    const urls = new Set<string>();
    for (const match of body.matchAll(RE_HREF_LOG_URL)) {
        const url = match.groups?.url;
        if (url) {
            urls.add(source.label ? `${source.label}=${url}` : url);
        }
    }
    return parseSources(urls, source);
}

function getSqlTimeStamp(value: string) {
    const [date, time] = value.trim().split(/\s+/);
    const [h, m, _s] = time.split(":");
    const [s, ms] = _s.split(/[\.,]/);
    return Number(new Date(`${date}T${h}:${m}:${s}.${ms}`));
}

async function parseLogs(source: MemoryDataSource, input: Readable) {
    const reader = readline.createInterface({
        input,
        crlfDelay: Infinity,
    });
    reader.on("error", () => reader.close());
    const data: MemoryData[] = [];
    for await (const line of reader) {
        const match = line.match(R_MEMINFO);
        if (!match?.groups) {
            continue;
        }
        const { label: suiteLabel, suite, time, used, total, /* limit, */ tests } = match.groups;
        const isMobile = suite === MOBILE_SUITE ? 1 : 0;
        data.push({
            isMobile,
            source: source.id,
            // limit: Number(limit),
            suite: suiteLabel,
            tests: tests ? Number(tests) : undefined,
            time: getSqlTimeStamp(time),
            total: Number(total),
            used: Number(used),
        });
    }
    if (data.length) {
        logger.debug(
            `Got ${yellow(data.length)} memory readings from source ${brightBlue(source.label)}`
        );
    } else if (source.parent) {
        logger.debug(`Memory log source ${brightBlue(source.label)} is empty`);
    } else {
        logger.warn(`Memory log source ${brightBlue(source.label)} is empty`);
    }
    return data;
}

function parseSources(sourceContent: Iterable<string>, parent?: MemoryDataSource) {
    const sources: MemoryDataSource[] = [];
    const countMap = new Map<string, MemoryDataSource[]>();
    for (const line of sourceContent) {
        const buildSpec = line.trim();
        if (!buildSpec || R_SOURCE_COMMENT.test(buildSpec)) {
            continue;
        }
        let [label, ...urlParts] = buildSpec.split(R_LABEL_SEPARATOR);
        let url: string;
        if (urlParts.length) {
            url = urlParts.join("=");
        } else {
            url = label;
            label = "";
        }
        if (!label) {
            const buildNameMatch = url.match(R_BUILD_NAME);
            if (buildNameMatch) {
                label = buildNameMatch[1];
            } else {
                const urlSep = url.includes(sep) ? sep : "/";
                label = url.split(urlSep).at(-1) || "";
            }
        }
        const source: MemoryDataSource = {
            id: nextSourceId++,
            label: label ? unquote(label) : DEFAULT_LABEL,
            url,
        };
        if (parent) {
            source.parent = parent.id;
        }
        allSources[source.id] = source;

        countMap.set(source.label, (countMap.get(source.label) || []).concat([source]));
        sources.push(source);
    }

    // Increment automatically entries with the same name
    for (const countedSources of countMap.values()) {
        const length = countedSources.length;
        if (length > 1) {
            for (let i = 0; i < length; i++) {
                countedSources[i].label += ` #${i + 1}`;
            }
        }
    }

    return sources;
}

function unquote(string: string) {
    return R_DOUBLE_QUOTES.test(string) || R_SINGLE_QUOTES.test(string)
        ? string.slice(1, -1)
        : string;
}

const RE_HREF_LOG_URL = /href=['"](?<url>([^'"]*\/logs\/start_\w+\.txt))['"]/gm;
const SUPPORTED_PRIMARY_EDITORS = ["code", "codium", "pycharm", "webstorm", "subl"];
const SUPPORTED_BACKUP_EDITORS = ["nano", "vi", "vim", "emacs"];
const allSources: Record<number, MemoryDataSource> = {};
let nextSourceId = 1;

const DEFAULT_LABEL = "Source";
const MOBILE_SUITE = ".MobileWebSuite";
const MEMORY_DATA_DIR = join(__dirname, "..", "..", "memory_data");

const SOURCE_FILE_EMPTY_MESSAGE = `source file is empty or does not exist yet: run ${brightCyan`odoo memory --edit`} and add source URLs`;

const SOURCE_PATH = join(MEMORY_DATA_DIR, "data_sources.ini");
const JS_DATA_FILE = join(MEMORY_DATA_DIR, "log_data.js");

const R_BUILD_NAME = /build\/(.*)\/logs/g;
const R_DOUBLE_QUOTES = /^".*"$/;
const R_LABEL_SEPARATOR = /\s*=\s*/;
const R_MEMINFO =
    /(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d+(,\d+)?).*(?<suite>\.(Mobile)?\w*Suite).*: \[MEMINFO\] (?<label>@.+) \(after GC\) - used: (?<used>\d+) - total: (?<total>\d+) - limit: (?<limit>\d+)( - tests: (?<tests>\d+))?.*/;
const R_SINGLE_QUOTES = /^'.*'$/;
const R_SOURCE_COMMENT = /^[#;]/;
const R_URL = /^https?:\/\//;

Command.register({
    name: "memory",
    alias: "mem",
    options: [
        {
            ["edit"]: {
                short: "e",
                standalone: true,
                help: [`Open the sources file with the available editor`],
            },
            ["force"]: {
                short: "f",
                standalone: true,
                help: [`Force fetch sources even if they haven't changed since last fetch`],
            },
            ["noopen"]: {
                short: "o",
                standalone: true,
                help: [`Do not open memory data results in the browser after processing`],
            },
            ["sources"]: {
                help: [
                    `URL or path to log files that will be used instead of those in the data source file`,
                ],
            },
        },
    ],
    defaultOption: "sources",
    async handler() {
        if (this.options.edit) {
            logger.info("Opening source file for editing");
            await editMemorySources(SOURCE_PATH);
        }

        let sourceContent: string[];
        if (this.options.sources?.values) {
            sourceContent = this.options.sources.values;
        } else {
            // Get source URLs from data source file
            logger.debug(`Reading memory logs from source file ${cyan(SOURCE_PATH)}`);
            try {
                const sourceFileContent = await readFile(SOURCE_PATH, "utf-8");
                sourceContent = sourceFileContent.split("\n");
            } catch {
                throw new LocalError(SOURCE_FILE_EMPTY_MESSAGE);
            }
        }
        const sourceEntries = parseSources(sourceContent);
        if (!sourceEntries.length) {
            throw new LocalError(SOURCE_FILE_EMPTY_MESSAGE);
        }

        const sourceHash = getSourceHash(sourceEntries);
        let shouldReload = !!this.options.force;
        if (!shouldReload) {
            const dataHash = await getDataHash(JS_DATA_FILE);
            shouldReload = sourceHash !== dataHash;
        }
        if (shouldReload) {
            // Force or hash changed:
            // -> fetch file sources (remotely or locally)
            logger.info(`Parsing memory data from ${yellow(sourceEntries.length)} sources`);
            const data = await fetchSourceContents(sourceEntries);
            await writeFile(
                JS_DATA_FILE,
                `// ${sourceHash}\n((exports) => {\n  exports.LOG_SOURCES = ${JSON.stringify(
                    allSources
                )};\n  exports.LOG_DATA = ${JSON.stringify(data.flat())};\n})(window.top);\n`,
                "utf-8"
            );
        } else {
            // No hash change:
            // -> re-use same data file
            logger.info("Reading local data.");
        }

        if (!this.options.noopen) {
            logger.info(`Opening graph view in browser`);
            await $`open ${join(MEMORY_DATA_DIR, "index.html")}`;
        }
    },
    help: [`Fetch logs and plot performance and memory usage`],
});
