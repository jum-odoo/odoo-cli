import type { Command, CommandHelp, CommandResolver } from "./command";
import { ADDON_PATHS, CONFIG_PATH, DEBUG_KEYWORD, setDebug } from "./constants";
import { ensureOdooConfig, parseAddons } from "./utils";

export interface CommandOptionDefinition {
    autoInclude?: boolean;
    defaultValues?: CommandResolver<string[]>;
    effect?: (command: Command) => any;
    flag?: boolean;
    /** Set on options synthesized on the fly for an unrecognized `--name`; see `forwardUnknownOptions`. */
    forwarded?: boolean;
    help?: CommandHelp;
    name: string;
    parse?: (values: Iterable<string>) => Iterable<string> | PromiseLike<Iterable<string>>;
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

    async applyEffect(command: Command) {
        if (this.definition?.effect) {
            await this.definition.effect(command);
        }
    }

    async parseValues() {
        if (this.definition.parse) {
            this.values = Array.from(await this.definition.parse(this.values));
        }
    }
}

CommandOption.register({
    name: "database",
    short: "d",
    flag: true,
    help: [
        "Database(s) used when installing or updating modules. Providing a comma-separated list restrict access to databases provided in list",
        "Defaults to this worktree's odoo.conf db_name, itself defaulting to the Odoo version",
    ],
});

CommandOption.register({
    name: "init",
    short: "i",
    flag: true,
    parse: parseAddons,
    help: ["Comma-separated list of modules to install before running the server"],
});

CommandOption.register({
    name: "update",
    short: "u",
    flag: true,
    parse: parseAddons,
    help: [
        "Comma-separated list of modules to update before running the server. Use 'all' for all modules",
    ],
});

CommandOption.register({
    name: "reinit",
    flag: true,
    parse: parseAddons,
    help: [
        "Comma-separated list of modules to reinitialize before starting the server.",
        "The reinitialization is similar to a simple upgrade without executing any upgrade script.",
        "It loads data in init mode instead of update mode, primarily affecting records marked as 'noupdate'.",
        "All modules that depend directly or indirectly on the specified ones will also be reinitialized",
    ],
});

CommandOption.register({
    name: "config",
    short: "c",
    flag: true,
    defaultValues: async () => {
        await ensureOdooConfig();
        return [CONFIG_PATH];
    },
    help: [
        "Path to an alternate configuration file. Defaults to this worktree's own odoo.conf (created with sensible defaults on first use if missing)",
    ],
});

CommandOption.register({
    name: "community",
    standalone: true,
    effect(command) {
        command.registerOption("addons-path", "long", []);
        command.getOption("addons-path")!.values = [ADDON_PATHS.community];
    },
    help: [
        "Removes 'enterprise' from the addons-path, effectively running the database with community-only files",
    ],
});

CommandOption.register({
    name: DEBUG_KEYWORD,
    autoInclude: true,
    standalone: true,
    help: ["Log debug information and sub-commands in the console"],
});

CommandOption.register({
    name: "http-port",
    short: "p",
    flag: true,
    help: ["Port on which the HTTP server listens. Defaults to this worktree's odoo.conf http_port"],
});

CommandOption.register({
    name: "open",
    standalone: true,
    help: ["Open Odoo in the default browser"],
});
