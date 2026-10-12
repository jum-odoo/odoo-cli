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

// The actual git checkout root for each repo, regardless of which version worktree the CWD
// resolution below may pick for COMMUNITY_PATH/ENTERPRISE_PATH. Node packages (node_modules,
// package.json, lock file) and any path-independent config (.eslintrc.json, .eslintignore, git
// hooks) must be shared across every worktree, so they belong here rather than under a version
// subdirectory.
export const COMMUNITY_ROOT_PATH = join(ROOT_PATH, "community");
export const ENTERPRISE_ROOT_PATH = join(ROOT_PATH, "enterprise");

// `COMMUNITY_ROOT_PATH`/`ENTERPRISE_ROOT_PATH` are bare-repo containers with no checked-out files
// of their own (see AGENTS.md) — every real checkout, including the default branch, is a sibling
// worktree (`master`, `18.0`, ...). So absent a version worktree in the CWD, `master` is the
// correct default, not the bare root itself.
let comPath = join(COMMUNITY_ROOT_PATH, "master");
let entPath = join(ENTERPRISE_ROOT_PATH, "master");
for (const repoRootPath of [COMMUNITY_ROOT_PATH, ENTERPRISE_ROOT_PATH]) {
    const repoRootPrefix = repoRootPath + sep;
    if (CWD.startsWith(repoRootPrefix)) {
        const [worktreeDir] = CWD.slice(repoRootPrefix.length).split(sep).filter(Boolean);
        if (worktreeDir === "master" || RE_ODOO_VERSION.test(worktreeDir)) {
            comPath = join(COMMUNITY_ROOT_PATH, worktreeDir);
            entPath = join(ENTERPRISE_ROOT_PATH, worktreeDir);
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

// Per-worktree odoo-bin configuration file: lives next to `odoo-bin` itself (i.e. inside
// COMMUNITY_PATH, so a version worktree like `community/18.0` gets its own), gitignored via each
// worktree's own `/odoo.conf` pattern. Holds the defaults `odoo-cli` used to hardcode (database,
// addons-path, dev, http-port), so odoo-bin picks them up on its own via `-c` and the CLI no
// longer needs to forward them as separate flags.
export const CONFIG_FILE_NAME = "odoo.conf";
export const CONFIG_PATH = join(COMMUNITY_PATH, CONFIG_FILE_NAME);
export const DEFAULT_HTTP_PORT = "8069";

export const MANIFEST_FILE_NAME = "__manifest__.py";
export const ADDON_PACKS: Record<string, string[]> = {
    default: ["crm", "planning", "project", "website"],
    livechat: ["im_livechat"],
    accounting: ["account_accountant"],
};
