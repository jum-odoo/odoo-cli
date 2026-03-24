import { CommandOption, CommandOptionType, type CommandOptionDefinition } from "./command_options";
import { START_COMMAND } from "./constants";
import { HIGHLIGHT, logger, removeHighlight } from "./logger";
import {
    and,
    filtered,
    getErrorMessageWithHelp,
    getOdooVersion,
    mapped,
    plural,
    sorted,
} from "./utils";

export type CommandHelp = (string | string[])[];

export interface CommandParameters {
    name: string;
    optionName?: string;
}

export interface CommandDefinition {
    alias?: string;
    defaultArgs?: CommandResolver<string[]>;
    handler: CommandHandler;
    help: CommandHelp;
    name: string;
    options: CommandOptionDefinition[];
    parameters?: CommandParameters;
}

export interface CommandParametersDefinition {}

export type CommandHandler = (this: Command, ...args: string[]) => any;

export type CommandResolver<T> = T | ((this: Command) => T | PromiseLike<T>);

const { blue, brightBlue, brightCyan, brightGreen, brightMagenta, brightRed, cyan, dim, magenta } =
    HIGHLIGHT;

function* formatHelp(
    label: string,
    [firstLine, ...helpLines]: CommandHelp,
    additionalSpacing: number
) {
    const labelLength = removeHighlight(label).length;
    const spacing = " ".repeat(additionalSpacing - labelLength) + HELP_INDENT;
    yield HELP_INDENT + label + spacing + ((typeof firstLine === "string" && firstLine) || "");
    if (helpLines.length) {
        const entryIndent = HELP_INDENT + " ".repeat(labelLength) + spacing;
        for (const helpLine of helpLines) {
            if (typeof helpLine === "string") {
                yield entryIndent + helpLine;
            } else {
                for (const line of helpLine) {
                    yield entryIndent + line;
                }
            }
        }
    }
}

const EXECUTABLE_NAME = "odoo";
const HELP_KEYWORD = "help";
const HELP_INDENT = "  ";
const OPTION_VALUE_SUFFIX = "=<val>";
const VERSION_KEYWORD = "version";

// NOT declared with `Command.register` because it shouldn't be listed as a regular command.
const versionCommandDefinition: CommandDefinition = {
    name: VERSION_KEYWORD,
    options: [],
    help: [],
    async handler() {
        logger.log(await getOdooVersion());
    },
};

export class Command {
    static definitions: Map<string, CommandDefinition> = new Map();

    static find(args: string[]) {
        const firstNonOptionIndex = args.findIndex((arg) => !arg.startsWith("-"));
        if (firstNonOptionIndex < 0) {
            return new this(this.definitions.get(START_COMMAND)!, true);
        }
        const name = args.splice(firstNonOptionIndex, 1)[0].toLowerCase();
        let commandDefinition = this.definitions.get(name);
        if (!commandDefinition) {
            const aliases: Record<string, CommandDefinition> = {};
            for (const desc of this.definitions.values()) {
                if (!desc.alias) {
                    continue;
                }
                if (desc.alias === name) {
                    commandDefinition = desc;
                    break;
                }
                aliases[desc.alias] = desc;
            }
            if (!commandDefinition) {
                return getErrorMessageWithHelp(
                    "command",
                    [name],
                    Object.keys(aliases).concat(...this.definitions.keys()),
                    brightMagenta
                );
            }
        }

        return new this(commandDefinition, false);
    }

    static register(
        definition: Omit<CommandDefinition, "options"> & {
            options?: Parameters<typeof CommandOption.parse>;
        }
    ) {
        const fullDefinition = {
            ...definition,
            options: CommandOption.parse(...(definition.options || [])),
        };
        this.definitions.set(definition.name, fullDefinition);
        return fullDefinition;
    }

    definition: CommandDefinition;
    isDefaultCommand: boolean;
    options: Map<string, CommandOption> = new Map();

    constructor(definition: CommandDefinition, isDefaultCommand: boolean) {
        this.definition = definition;
        this.isDefaultCommand = isDefaultCommand;
    }

    getOption(optionName: string) {
        return this.options.get(optionName);
    }

    getOptionValues(optionName: string) {
        return this.options.get(optionName)?.values || [];
    }

    hasOption(optionName: string) {
        return this.options.has(optionName);
    }

    async processOptions() {
        if (this.hasOption(HELP_KEYWORD)) {
            if (this.isDefaultCommand) {
                this.definition = helpCommandDefinition;
                this.options.clear();
            } else {
                for (const name in this.options.keys()) {
                    if (name !== HELP_KEYWORD) {
                        this.options.delete(name);
                    }
                }
            }
            return;
        }
        if (this.definition.name === HELP_KEYWORD) {
            this.options.clear();
            return;
        }
        if (this.hasOption(VERSION_KEYWORD) && this.isDefaultCommand) {
            this.definition = versionCommandDefinition;
            return;
        }

        // Auto-complete default options & check missing required options
        const missingRequiredOptions: string[] = [];
        for (const optionDefinition of this.definition.options) {
            const { defaultValues, name, required } = optionDefinition;
            if (this.hasOption(name)) {
                continue;
            }
            if (defaultValues) {
                // Option has a default value
                this.registerOption(name, "long", await this.resolve(defaultValues));
            } else if (required) {
                // Option is required
                missingRequiredOptions.push(name);
            }
        }

        if (missingRequiredOptions.length) {
            return [
                `missing required ${plural("option", missingRequiredOptions)}: ${and(missingRequiredOptions, brightRed)}.`,
            ];
        }

        // Parse option values (in parallel)
        await Promise.all(mapped(this.options.values(), (option) => option.parseValues()));

        // Apply option effects (sequentially)
        for (const option of this.options.values()) {
            await option.applyEffect(this);
        }
    }

    registerOption(optionName: string, type: CommandOptionType, values: string[]) {
        if (this.definition.name === HELP_KEYWORD) {
            return true;
        }
        const lower = optionName.toLowerCase();
        let optionDefinition = this.definition.options.find(
            (option) => option.short === optionName || (type === "long" && option.name === lower)
        );
        if (!optionDefinition) {
            if (type === "short") {
                return false;
            }
            optionDefinition = {
                name: optionName,
                flag: true,
            };
        }
        if (!this.hasOption(optionDefinition.name)) {
            this.options.set(optionDefinition.name, new CommandOption(optionDefinition, type));
        }
        const filteredValues = values.filter(Boolean);
        if (filteredValues.length) {
            const definition = this.getOption(optionDefinition.name)!;
            if (!definition.acceptsValues) {
                return false;
            }
            definition.values.push(...filteredValues);
        }
        return true;
    }

    resolve<T>(value: CommandResolver<T>): T | PromiseLike<T> {
        return typeof value === "function"
            ? (value as Exclude<CommandResolver<T>, T>).call(this)
            : value;
    }

    async run() {
        if (this.hasOption(HELP_KEYWORD) && this.definition.name !== HELP_KEYWORD) {
            const parameters = this.definition.parameters;
            const message = [
                `${brightCyan`Usage`}: ${brightGreen(EXECUTABLE_NAME)} ${brightMagenta(this.definition.name)} ${
                    parameters ? brightBlue`<${parameters.name}> ` : ""
                }${cyan`[...options]`}`,
            ];
            if (this.definition.alias) {
                message.push(
                    `${brightCyan`Alias`}: ${brightGreen(EXECUTABLE_NAME)} ${brightMagenta(this.definition.alias)}`
                );
            }

            let parameterOption!: CommandOptionDefinition;
            let hasShort = false;
            const filteredOptions = mapped(
                filtered(this.definition.options, (option) => option.help),
                (option) => {
                    hasShort ||= !!option.short;
                    if (option.name === parameters?.optionName) {
                        parameterOption = option;
                        option = Object.create(option);
                        option.help = [
                            dim`Option form of the ` +
                                brightBlue(parameters.name) +
                                dim` parameter; look up above for more information`,
                        ];
                    }
                    return option;
                }
            );

            const sortedOptions = sorted(filteredOptions, "name");
            const shortIndent = hasShort ? " ".repeat(4) : "";
            let totalSpacing = 0;
            const optionHelpEntries = sortedOptions.map((option) => {
                const longFlag = `--${option.name}`;
                let optionFlags = option.short
                    ? `-${option.short}, ` + longFlag
                    : shortIndent + longFlag;
                if (!option.standalone) {
                    optionFlags += dim(OPTION_VALUE_SUFFIX);
                }
                totalSpacing = Math.max(totalSpacing, removeHighlight(optionFlags).length);
                return [cyan(optionFlags), option.help!] as [string, CommandHelp];
            });

            if (parameterOption) {
                let label = brightBlue(parameters!.name);
                if (parameterOption.required) {
                    label += blue` (required)`;
                }
                totalSpacing = Math.max(totalSpacing, removeHighlight(label).length);
                message.push("", `${brightCyan`Parameters`}:`);
                message.push(...formatHelp(label, parameterOption.help!, totalSpacing));
            }

            message.push("", `${brightCyan`Options`}:`);
            for (const [flag, helpInfo] of optionHelpEntries) {
                message.push(...formatHelp(flag, helpInfo, totalSpacing));
            }

            logger.log(message.join("\n"));
            return;
        }

        // Generate final command arguments from option values
        const args: string[] = (await this.resolve(this.definition.defaultArgs)) || [];
        for (const option of this.options.values()) {
            if (option.definition?.flag) {
                let flag = `--${option.definition.name}`;
                if (option.values.length) {
                    flag += "=" + option.values.join(",");
                }
                args.push(flag);
            }
        }

        // Call command handler
        await this.definition.handler.call(this, ...args);
    }
}

const helpCommandDefinition = Command.register({
    name: HELP_KEYWORD,
    options: [],
    parameters: {
        name: "noop",
    },
    async handler() {
        const message = [
            `${brightCyan`Usage`}: ${brightGreen(
                EXECUTABLE_NAME
            )} ${brightBlue`<command>`} ${cyan`[...options]`}`,
            "",
            `${brightCyan`Commands`}:`,
        ];
        const sortedDefinitions = sorted(Command.definitions, 0);
        const commandHelp = `${magenta`<command>`} ${brightCyan`--${HELP_KEYWORD}`}`;
        const commandHelpLength = removeHighlight(commandHelp).length;
        let totalSpacing = commandHelpLength;
        for (const [name] of sortedDefinitions) {
            totalSpacing = Math.max(totalSpacing, name.length);
        }
        for (const [name, definition] of sortedDefinitions) {
            message.push(...formatHelp(brightMagenta(name), definition.help, totalSpacing));
        }

        // Generic "<command> --help" line
        const commandSpacing = totalSpacing - commandHelpLength;
        message.push(
            `${HELP_INDENT}${commandHelp}${" ".repeat(commandSpacing)}${HELP_INDENT}Display help text for a specific command`
        );

        // Version help
        const versionOptionHelp = `-${VERSION_KEYWORD[0]}, --${VERSION_KEYWORD}`;
        const versionSpacing = totalSpacing - versionOptionHelp.length;
        message.push(
            `${HELP_INDENT}${cyan(versionOptionHelp)}${" ".repeat(versionSpacing)}${HELP_INDENT}Display Odoo version`
        );

        logger.log(message.join("\n"));
    },
    help: ["Display list of available commands"],
});

CommandOption.register({
    name: HELP_KEYWORD,
    short: "h",
    autoInclude: true,
    standalone: true,
    help: ["Display help text for this command"],
});

CommandOption.register({
    name: VERSION_KEYWORD,
    short: "v",
    autoInclude: true,
    standalone: true,
});
