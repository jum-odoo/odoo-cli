import type { Command, CommandResolver } from "./command";
import { ADDON_PATHS, LocalError, setDebug } from "./constants";
import { HIGHLIGHT } from "./logger";
import { getOdooVersion, parseAddons } from "./utils";

const { brightBlue, brightCyan } = HIGHLIGHT;

export interface CommandOptionDefinition {
    autoInclude?: boolean;
    defaultValues?: CommandResolver<string[]>;
    effect?: (command: Command) => any;
    flag?: string;
    help: (string | string[])[];
    name: string;
    parse?: (values: string[]) => string[] | PromiseLike<string[]>;
    required?: boolean;
    short?: string;
    standalone?: boolean;
}

export type CommandOptionType = "short" | "long";

export class CommandOption {
    static definitions: Map<string, CommandOptionDefinition> = new Map();

    static parse(
        ...specs: (
            | string
            | Record<string, Partial<CommandOptionDefinition> | null>
            | [string, Partial<CommandOptionDefinition> | null]
        )[]
    ) {
        const result: Record<string, CommandOptionDefinition> = Object.create(null);
        while (specs.length) {
            const spec = specs.shift()!;
            const specObject = typeof spec === "string" ? ([spec, null] as [string, null]) : spec;
            if (!Array.isArray(specObject)) {
                specs.unshift(...Object.entries(specObject));
                continue;
            }
            if (specObject[0] === "*") {
                specs.unshift(...this.definitions.keys());
                continue;
            }
            const [name, override] = specObject;
            result[name] = {
                ...(result[name] ?? this.definitions.get(name)),
                ...override,
                name,
            };
        }
        for (const option of this.definitions.values()) {
            if (option.autoInclude) {
                result[option.name] ||= option;
            }
        }
        return Object.values(result);
    }

    static register(definition: CommandOptionDefinition) {
        this.definitions.set(definition.name, definition);
        return definition;
    }

    definition: CommandOptionDefinition;
    type: CommandOptionType;
    values: string[] = [];

    get acceptsValues() {
        return !this.definition.standalone;
    }

    constructor(definition: CommandOptionDefinition, type: CommandOptionType) {
        this.definition = definition;
        this.type = type;
    }

    addValues(...values: string[]) {
        if (!this.acceptsValues) {
            throw new LocalError(
                `option ${brightCyan(this.definition.name)} does not accept any values`
            );
        }
        this.values.push(...values);
    }

    async applyEffect(command: Command) {
        if (this.definition?.effect) {
            await this.definition.effect(command);
        }
    }

    async parseValues() {
        if (this.definition.parse) {
            this.values = await this.definition.parse(this.values);
        }
    }
}

CommandOption.register({
    name: "database",
    short: "d",
    flag: "--database",
    defaultValues: async () => [await getOdooVersion()],
    help: [
        "Database(s) used when installing or updating modules. Providing a comma-separated list restrict access to databases provided in list",
    ],
});

CommandOption.register({
    name: "init",
    short: "i",
    flag: "--init",
    parse: parseAddons,
    help: ["Comma-separated list of modules to install before running the server"],
});

CommandOption.register({
    name: "update",
    short: "u",
    flag: "--update",
    parse: parseAddons,
    help: [
        "Comma-separated list of modules to update before running the server. Use 'all' for all modules",
    ],
});

CommandOption.register({
    name: "reinit",
    flag: "--reinit",
    parse: parseAddons,
    help: [
        "Comma-separated list of modules to reinitialize before starting the server.",
        "The reinitialization is similar to a simple upgrade without executing any upgrade script.",
        "It loads data in init mode instead of update mode, primarily affecting records marked as 'noupdate'.",
        "All modules that depend directly or indirectly on the specified ones will also be reinitialized",
    ],
});

CommandOption.register({
    name: "addons-path",
    flag: "--addons-path",
    defaultValues: Object.values(ADDON_PATHS),
    help: [
        "Comma-separated list of directories in which modules are stored. These directories are scanned for modules",
    ],
});

CommandOption.register({
    name: "config",
    short: "c",
    flag: "--config",
    help: [
        "Path to an alternate configuration file. If not defined, Odoo checks ODOO_RC environmental variable and default location $HOME/.odoorc",
    ],
});

CommandOption.register({
    name: "community",
    standalone: true,
    effect(command) {
        const pathOption = command.options["addons-path"];
        if (pathOption) {
            pathOption.values = [ADDON_PATHS.community];
        }
    },
    help: [
        "Removes 'enterprise' from the addons-path, effectively running the database with community-only files",
    ],
});

CommandOption.register({
    name: "debug",
    autoInclude: true,
    standalone: true,
    effect: () => setDebug(true),
    help: ["Log debug information and sub-commands in the console"],
});

CommandOption.register({
    name: "dev",
    flag: "--dev",
    defaultValues: ["all"],
    help: [
        "Comma-separated list of features. Possible features are:",
        [
            `• ${brightBlue`all`}: alias for ${brightBlue`xml`},${brightBlue`reload`},${brightBlue`qweb`},${brightBlue`access`};`,
            `• ${brightBlue`xml`}: read QWeb template from xml file directly instead of database;`,
            `• ${brightBlue`reload`}: restart server when python file are updated (may not be detected depending on the text editor used);`,
            `• ${brightBlue`qweb`}: break in the evaluation of QWeb template when a node contains t-debug='debugger';`,
            `• ${brightBlue`werkzeug`}: display the full traceback on the frontend page in case of exception;`,
            `• ${brightBlue`replica`}: simulate simulate a deployment with readonly replica;`,
            `• ${brightBlue`access`}: log the traceback next to the AccessError when it results in a 403 - Forbidden HTTP response.`,
        ],
    ],
});

CommandOption.register({
    name: "load-language",
    short: "l",
    flag: "--load-language",
    help: ["Comma-separated list of languages for the translations that will be loaded"],
});

CommandOption.register({
    name: "http-port",
    short: "p",
    flag: "--http-port",
    defaultValues: ["8069"],
    help: ["Port on which the HTTP server listens, defaults to 8069"],
});

CommandOption.register({
    name: "open",
    standalone: true,
    help: ["Open Odoo in the default browser"],
});

// CommandOption.register({
//     name: "login",
//     help: ["Not working ATM"],
// });
