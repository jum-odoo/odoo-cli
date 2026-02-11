import { homedir } from "os";
import { join } from "path";

let debug = false;

export function isDebug() {
    return debug;
}

export function setDebug(value: boolean) {
    debug = value;
}

export class LocalError extends Error {}

export const START_COMMAND = "server";
export const LOCAL_HOST = "http://127.0.0.1";

export const ROOT_PATH = join(homedir(), "odoo");
export const COMMUNITY_PATH = join(ROOT_PATH, "community");
export const ENTERPRISE_PATH = join(ROOT_PATH, "enterprise");

export const ADDON_PATHS = {
    ["community"]: join(COMMUNITY_PATH, "addons"),
    ["design-themes"]: join(ROOT_PATH, "design-themes"),
    ["enterprise"]: ENTERPRISE_PATH,
    ["translate-ui"]: join(ROOT_PATH, "translate-ui"),
};
export const BIN_PATH = join(COMMUNITY_PATH, "odoo-bin");
export const SRC_PATH = join("static", "src");

export const MANIFEST_FILE_NAME = "__manifest__.py";
export const ADDON_PACKS: Record<string, string[]> = {
    default: ["crm", "planning", "project", "website"],
    livechat: ["im_livechat"],
    sales: ["sale"],
    accounting: ["account_accountant"],
};

export const R_FULL_MATCH = /^--(?<name>[\w-]+)/;
export const R_SHORT_MATCH = /^-(?<names>[\w-]+)/;
export const R_VALID_MODULE_NAME = /^[a-z][\w-]*$/;
