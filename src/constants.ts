import { homedir } from "os";
import { join, sep } from "path";
import { cwd } from "process";

const CWD = cwd();
const PUNCTUATION = new Set(".!?");
let debug = false;

export function isDebug() {
    return debug;
}

export function setDebug() {
    debug = true;
}

export class LocalError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        if (message) {
            message = message[0].toUpperCase() + message.slice(1);
            if (!PUNCTUATION.has(message.at(-1)!)) {
                message += ".";
            }
        }
        super(message, options);
    }
}

export const LOCAL_HOST = "http://127.0.0.1";
export const LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;


export const RE_FULL_MATCH = /^--(?<name>[\w-]+)/;
export const RE_ODOO_VERSION = /(?:saas[~-])?(?<number>\d+\.\d)/;
export const RE_NON_ALPHANUM = /\W/g;
export const RE_SHORT_MATCH = /^-(?<names>[\w-]+)/;
export const RE_VALID_MODULE_NAME = /^[a-z][\w-]*$/;

// Special strings
export const DEBUG_KEYWORD = "debug";
export const EXECUTABLE_NAME = "odoo";
export const HELP_KEYWORD = "help";
export const START_COMMAND = "server";
export const VERSION_KEYWORD = "version";

export const ROOT_PATH = join(homedir(), "odoo");

let comPath = join(ROOT_PATH, "community");
let entPath = join(ROOT_PATH, "enterprise");
for (const repoPath of [comPath, entPath]) {
    if (CWD.startsWith(repoPath) && CWD.length > repoPath.length) {
        const [rootDir] = CWD.slice(repoPath.length).split(sep).filter(Boolean);
        if (rootDir === "master" || RE_ODOO_VERSION.test(rootDir)) {
            comPath = join(comPath, rootDir);
            entPath = join(entPath, rootDir);
            break;
        }
    }
}

export const COMMUNITY_PATH = comPath;
export const ENTERPRISE_PATH = entPath;

export const ADDON_PATHS = {
    ["community"]: join(COMMUNITY_PATH, "addons"),
    ["design-themes"]: join(ROOT_PATH, "design-themes"),
    ["enterprise"]: ENTERPRISE_PATH,
};
export const BIN_PATH = join(COMMUNITY_PATH, "odoo-bin");
export const SRC_PATH = join("static", "src");

export const MANIFEST_FILE_NAME = "__manifest__.py";
export const ADDON_PACKS: Record<string, string[]> = {
    default: ["crm", "planning", "project", "website"],
    livechat: ["im_livechat"],
    accounting: ["account_accountant"],
};
