import { createHash } from "crypto";
import { createReadStream } from "fs";
import { readdir, readFile, rm, writeFile } from "fs/promises";
import { join, sep } from "path";
import readline from "readline/promises";
import { Command } from "../command";
import { LocalError } from "../constants";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import { ensureDirectory } from "../utils";

const { brightBlue, brightCyan, cyan, yellow } = HIGHLIGHT;

type MemoryEntry = [label: string, values: MemoryData[]];

type RawEntry = [label: string, content: string];

interface MemoryData {
    isMobile: boolean;
    label: string;
    limit: number;
    suite: string;
    tests: number;
    time: number;
    total: number;
    used: number;
}

async function clearDirectories(...directories: string[]) {
    await Promise.all(
        directories.map((dir) =>
            readdir(dir).then(
                (fileNames) =>
                    Promise.all(
                        fileNames.map((fname) =>
                            rm(join(dir, fname), { force: true, recursive: true })
                        )
                    ),
                () => []
            )
        )
    );
}

const SUPPORTED_PRIMARY_EDITORS = ["code", "codium", "pycharm", "webstorm", "subl"];
const SUPPORTED_BACKUP_EDITORS = ["nano", "vi", "vim", "emacs"];

async function editMemorySources(sourceFilePath: string) {
    const primaryEditor = await findEditor(SUPPORTED_PRIMARY_EDITORS);
    if (primaryEditor) {
        return $`${primaryEditor} ${sourceFilePath}`;
    }

    const backupEditor = await findEditor(SUPPORTED_BACKUP_EDITORS);
    if (backupEditor) {
        return $`${backupEditor} ${sourceFilePath}`;
    }

    throw new LocalError("no editor found on this system.");
}

async function fetchSourceContents(sources: RawEntry[], logsDir: string, force: boolean) {
    await ensureDirectory(logsDir);
    const existingLogs = new Set(force ? [] : await readdir(logsDir));
    return Promise.all(
        sources.map(async ([label, url]): Promise<MemoryEntry> => {
            const urlFileName = urlToFileName(url);
            if (existingLogs.has(urlFileName)) {
                url = join(logsDir, urlFileName);
            }
            const localPath = join(logsDir, urlFileName);
            if (R_URL.test(url)) {
                // Fetch source from URL
                logger.debug(`Fetching memory logs from URL ${yellow(url)}`);
                const response = await fetch(url);
                const content = await response.text();
                const data = parseLogs(label, content);
                await writeFile(localPath, JSON.stringify(data), "utf-8");
                return [label, data];
            } else {
                // Fetch source from file
                logger.debug(`Reading memory logs from file ${cyan(url)}`);
                const content = await readFile(url, "utf-8");
                let data;
                try {
                    // If it works: the file already contains properly parsed content
                    data = JSON.parse(content);
                } catch {
                    // If it doesn't: write a copy (or overwrite the file if already a local one) with parsed content
                    data = parseLogs(label, content);
                    await writeFile(localPath, JSON.stringify(data), "utf-8");
                }
                return [label, data];
            }
        })
    );
}

function findEditor(editors: string[]) {
    return Promise.any(editors.map((editor) => $`${editor} --version`.then(() => editor))).catch(
        () => false
    );
}

async function getDataHash(path: string) {
    const def = Promise.withResolvers();
    const stream = createReadStream(path, { encoding: "utf-8" });
    const reader = readline.createInterface({ input: stream });
    reader.on("error", () => def.resolve("null"));
    reader.on("line", (line) => def.resolve(line.replaceAll(R_NON_ALPHANUM, "")));
    return def.promise.finally(() => {
        reader.close();
        stream.close();
    });
}

function getSourceHash(sourceEntries: RawEntry[]) {
    const hash = createHash("sha256");
    for (const [, url] of sourceEntries) {
        hash.update(url);
    }
    return hash.digest("hex");
}

function getSqlTimeStamp(value: string) {
    const [date, time] = value.trim().split(/\s+/);
    const [h, m, _s] = time.split(":");
    const s = _s.slice(0, 2);
    const ms = _s.slice(2).padEnd(3, "0");

    const isoString = `${date}T${h}:${m}:${s}.${ms}`;

    return Number(new Date(isoString));
}

function parseLogs(label: string, content: string) {
    // Prepare source content
    const formattedContent = content
        .replaceAll(/(^.*?\[MEMINFO\] @.*$\n)|(^.*$\n)/gm, "$1")
        .replaceAll(/[,"]/gm, "")
        .replaceAll(R_MEMINFO, `$<label>,$<suite>,$<time>,$<used>,$<total>,$<limit>,$<tests>`);

    // Map & filter rows
    const rows: MemoryData[] = [];
    for (const line of formattedContent.split("\n")) {
        const [suiteLabel, suite, time, used, total, limit, tests] = line.split(",");
        if (!suiteLabel) {
            continue;
        }
        const values: MemoryData = {
            isMobile: suite === MOBILE_SUITE,
            label,
            limit: Number(limit),
            suite: suiteLabel === MOBILE_SUITE ? suiteLabel + " (mobile)" : suiteLabel,
            tests: Number(tests),
            time: getSqlTimeStamp(time),
            total: Number(total),
            used: Number(used),
        };
        rows.push(values);
    }
    if (rows.length) {
        logger.debug(`Got ${yellow(rows.length)} memory readings from source ${brightBlue(label)}`);
    } else {
        logger.warn(`Memory log source ${brightBlue(label)} is empty`);
    }
    return rows;
}

function parseSources(sourceContent: string[]) {
    const sources: RawEntry[] = [];
    const countMap = new Map<string, RawEntry[]>();
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
        const entry: RawEntry = [label ? unquote(label) : DEFAULT_LABEL, url];
        countMap.set(entry[0], (countMap.get(entry[0]) || []).concat([entry]));
        sources.push(entry);
    }

    // Increment automatically entries with the same name
    for (const entries of countMap.values()) {
        const length = entries.length;
        if (length > 1) {
            for (let i = 0; i < length; i++) {
                entries[i][0] += ` #${i + 1}`;
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

function urlToFileName(url: string) {
    return url
        .trim()
        .toLowerCase()
        .replaceAll(R_ESCAPED_FILE_NAME_SEPARATOR, "_")
        .replaceAll(R_NON_ALPHANUM, "");
}

async function writeMemoryData(entries: MemoryEntry[], hash: string, csv: boolean) {
    // generate csv and json file
    const csvData: Record<string, string[]> = {};
    if (csv) {
        csvData["Suite"] = entries.map((entry) => entry[0]);
    }
    const jsonData: MemoryData[] = [];
    for (const [, rows] of entries) {
        for (const values of rows) {
            jsonData.push(values);
            if (csv) {
                csvData[values.suite] ||= [];
                csvData[values.suite].push(...Object.values(values).map(String));
            }
        }
    }

    await ensureDirectory(OUTPUT_DIR);

    const stringifiedData = JSON.stringify(jsonData);
    const jsHash = /* js */ `// ${hash}`;
    const jsContent = /* js */ `((win) => { win.LOG_DATA = ${stringifiedData}; })(window.top);`;
    logger.debug(`Writing JS data to ${cyan(JS_DATA_FILE)}`);
    const promises = [writeFile(JS_DATA_FILE, [jsHash, jsContent].join("\n"), "utf-8")];
    if (csv) {
        logger.info(`Writing CSV data to ${cyan(CSV_DATA_FILE)}`);
        const csvHash = `# ${hash}`;
        const csvContent = Object.entries(csvData)
            .map(([firstCol, columns]) => [firstCol, ...columns].join(","))
            .join("\n");
        promises.push(writeFile(CSV_DATA_FILE, [csvHash, csvContent].join("\n"), "utf-8"));
    }
    await Promise.all(promises);
}

const DEFAULT_LABEL = "Source";
const MOBILE_SUITE = ".MobileWebSuite";
const MEMORY_DATA_DIR = join(__dirname, "..", "..", "memory_data");

const SOURCE_FILE_EMPTY_MESSAGE = `source file is empty or does not exist yet: run ${brightCyan`odoo memory --edit`} and add source URLs`;

const LOGS_DIR = join(MEMORY_DATA_DIR, "logs");
const OUTPUT_DIR = join(MEMORY_DATA_DIR, "output");
const SOURCE_PATH = join(MEMORY_DATA_DIR, "data_sources.ini");
const CSV_DATA_FILE = join(OUTPUT_DIR, "data.csv");
const JS_DATA_FILE = join(OUTPUT_DIR, "data.js");

const R_BUILD_NAME = /build\/(.*)\/logs/g;
const R_DOUBLE_QUOTES = /^".*"$/;
const R_ESCAPED_FILE_NAME_SEPARATOR = /[\s.\/:;#@-]+/g;
const R_LABEL_SEPARATOR = /\s*=\s*/;
const R_MEMINFO =
    /(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d+(,\d+)?).*(?<suite>\.(Mobile)?\w*Suite).*: \[MEMINFO\] (?<label>.+) \(after GC\) - used: (?<used>\d+) - total: (?<total>\d+) - limit: (?<limit>\d+)( - tests: (?<tests>\d+))?.*/gm;
const R_NON_ALPHANUM = /\W/g;
const R_SINGLE_QUOTES = /^'.*'$/;
const R_SOURCE_COMMENT = /^[#;]/;
const R_URL = /^https?:\/\//;

Command.register({
    name: "memory",
    alias: "mem",
    options: [
        {
            ["clear"]: {
                standalone: true,
                help: [`Clear the parsed output folder`],
            },
            ["csv"]: {
                standalone: true,
                help: [`Also output result to a ${cyan`output/data.csv`} file`],
            },
            ["edit"]: {
                short: "e",
                standalone: true,
                help: [`Open the sources file with the available editor`],
            },
            ["force"]: {
                short: "f",
                standalone: true,
                help: [`Fetch all logs even if they are already cached`],
            },
            ["noopen"]: {
                short: "o",
                standalone: true,
                help: [`Do not open memory data results in the default browser`],
            },
            ["sources"]: {
                help: [
                    `URL or path to log files that will be used instead of those in the data source file`,
                ],
            },
        },
    ],
    defaultOption: "sources",
    async handler({ options }) {
        if (options.clear) {
            logger.info("Clearing local memory logs & data outputs");
            await clearDirectories(LOGS_DIR, OUTPUT_DIR);
        }

        if (options.edit) {
            logger.info("Opening source file for editing");
            return editMemorySources(SOURCE_PATH);
        }

        let sourceContent: string[];
        if (options.sources?.values) {
            sourceContent = options.sources.values;
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
        let shouldReload = !!options.force;
        if (!shouldReload) {
            const checkHashPromises = [getDataHash(JS_DATA_FILE)];
            if (options.csv) {
                checkHashPromises.push(getDataHash(CSV_DATA_FILE));
            }
            const dataHashes = await Promise.all(checkHashPromises);
            shouldReload = !dataHashes.includes(sourceHash);
        }
        if (shouldReload) {
            // Force or hash changed:
            // -> fetch file sources (remotely or locally)
            logger.info(`Parsing memory data from ${yellow(sourceEntries.length)} sources`);
            const rowValues = await fetchSourceContents(sourceEntries, LOGS_DIR, !!options.force);
            await writeMemoryData(rowValues, sourceHash, !!options.csv);
        } else {
            // No hash change:
            // -> re-use same data file
            logger.info("Reading local data.");
        }

        if (!options.noopen) {
            logger.info(`Opening graph view in browser`);
            await $`open ${join(MEMORY_DATA_DIR, "index.html")}`;
        }
    },
    help: [`Fetch logs and plot performance and memory usage`],
});
