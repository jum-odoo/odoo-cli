import { CommandOption, CommandOptionType, type CommandOptionDefinition } from "./command_options";
import { BIN_PATH, LocalError, START_COMMAND } from "./constants";
import { HIGHLIGHT, logger } from "./logger";
import { $ } from "./process";
import { getErrorMessageWithHelp, resolve, Resolver } from "./utils";

const { brightBlue, brightCyan, brightGreen, brightMagenta, brightRed, cyan, dim } = HIGHLIGHT;

export interface CommandDefinition {
    alias?: string;
    defaultArgs?: Resolver<string[]>;
    defaultOption?: string;
    handler: CommandHandler;
    help: string[];
    name: string;
    options: CommandOptionDefinition[];
}

export type CommandHandler = (command: Command, args: string[]) => any;

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
        const version = await $`${BIN_PATH} --version`;
        logger.log(version);
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
                const errorMessage = getErrorMessageWithHelp(
                    "command",
                    [name],
                    Object.keys(aliases).concat(...this.definitions.keys()),
                    brightMagenta
                );
                throw new LocalError(errorMessage);
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
    options: Record<string, CommandOption> = Object.create(null);

    constructor(definition: CommandDefinition, isDefaultCommand: boolean) {
        this.definition = definition;
        this.isDefaultCommand = isDefaultCommand;
    }

    async processOptions() {
        if (HELP_KEYWORD in this.options) {
            if (this.isDefaultCommand) {
                this.definition = helpCommandDefinition;
                this.options = {};
            } else {
                for (const name in this.options) {
                    if (name !== HELP_KEYWORD) {
                        delete this.options[name];
                    }
                }
            }
            return;
        }
        if (this.definition.name === HELP_KEYWORD) {
            this.options = {};
            return;
        }
        if (VERSION_KEYWORD in this.options && this.isDefaultCommand) {
            this.definition = versionCommandDefinition;
            return;
        }

        // Auto-complete default options & check missing required options
        for (const optionDefinition of Object.values(this.definition.options || {})) {
            const { defaultValues, name, required } = optionDefinition;
            if (name in this.options) {
                continue;
            }
            if (defaultValues) {
                // Option has a default value
                const option = this.registerOption(name, "long");
                option?.addValues(...(await resolve(defaultValues)));
            } else if (required) {
                // Option is required
                throw new LocalError(`missing required option ${brightRed(name)}`);
            }
        }

        const optionList = Object.values(this.options);

        // Parse option values (in parallel)
        await Promise.all(optionList.map((option) => option.parseValues()));

        // Apply option effects (sequentially)
        for (const option of optionList) {
            await option.applyEffect(this);
        }
    }

    registerOption(optionName: string, type: CommandOptionType) {
        if (this.definition.name === HELP_KEYWORD) {
            return;
        }
        const lower = optionName.toLowerCase();
        const optionDefinition = this.definition.options?.find((option) => {
            if (type === "short") {
                return option.short === optionName;
            } else {
                return option.name === lower || option.short?.includes(lower);
            }
        });
        if (!optionDefinition) {
            return;
        }
        if (!(optionDefinition.name in this.options)) {
            this.options[optionDefinition.name] = new CommandOption(optionDefinition, type);
        }
        return this.options[optionDefinition.name];
    }

    async run() {
        if (HELP_KEYWORD in this.options && this.definition.name !== HELP_KEYWORD) {
            const defaultOption = this.definition.defaultOption;
            const message = [
                `${brightCyan`Usage`}: ${brightGreen(EXECUTABLE_NAME, this.definition.name)} ${
                    defaultOption ? brightBlue`<${defaultOption}> ` : ""
                }${cyan`[...options]`}`,
            ];
            if (this.definition.alias) {
                message.push(
                    `${brightCyan`Alias`}: ${brightGreen(EXECUTABLE_NAME, this.definition.alias)}`
                );
            }
            message.push("", `${brightCyan`Options`}:`);
            const sortedOptions = this.definition.options.sort((a, b) =>
                a.name.localeCompare(b.name)
            );
            let longestOption = 0;
            const optionHelpEntries = sortedOptions.map((option) => {
                const longFlag = `--${option.name}`;
                let optionFlags = option.short
                    ? `-${option.short}, ${longFlag}`
                    : " ".repeat(4) + longFlag;
                let optionLength = optionFlags.length;
                if (!option.standalone) {
                    optionLength += OPTION_VALUE_SUFFIX.length;
                    optionFlags += `${dim(OPTION_VALUE_SUFFIX)}`;
                }
                if (optionLength > longestOption) {
                    longestOption = optionLength;
                }
                return [optionFlags, optionLength, option.help] as [
                    string,
                    number,
                    (string | string[])[]
                ];
            });

            for (const [flag, length, helpInfo] of optionHelpEntries) {
                const spacing = longestOption - length;
                const prefix = HELP_INDENT + flag + " ".repeat(spacing) + HELP_INDENT;
                const entryIndent = " ".repeat(HELP_INDENT.length * 2 + spacing + length);
                const firstLine = typeof helpInfo[0] === "string" && helpInfo.shift();
                message.push(cyan(prefix) + (firstLine || ""));
                for (const helpEntry of helpInfo) {
                    if (typeof helpEntry === "string") {
                        message.push(entryIndent + helpEntry);
                    } else {
                        for (const line of helpEntry) {
                            message.push(entryIndent + line);
                        }
                    }
                }
            }

            logger.log(message.join("\n"));
            return;
        }

        // Generate final command arguments from option values
        const args: string[] = (await resolve(this.definition.defaultArgs)) || [];
        for (const option of Object.values(this.options)) {
            if (option.definition?.flag) {
                let flag = option.definition.flag;
                if (option.values.length) {
                    flag += "=" + option.values.join(",");
                }
                args.push(flag);
            }
        }

        // Call command handler
        await this.definition.handler(this, args);
    }
}

const helpCommandDefinition = Command.register({
    name: HELP_KEYWORD,
    options: [],
    async handler() {
        const message = [
            `${brightCyan`Usage`}: ${brightGreen(
                EXECUTABLE_NAME
            )} ${brightBlue`<command>`} ${cyan`[...options]`}`,
            "",
            `${brightCyan`Commands`}:`,
        ];
        const sortedDefinitions = [...Command.definitions].sort((a, b) => a[0].localeCompare(b[0]));
        const commandHelpParts = ["<command>", `--${HELP_KEYWORD}`];
        const commandHelpLength = commandHelpParts.join(" ").length;
        let longestCommand = commandHelpLength;
        for (const [name] of sortedDefinitions) {
            if (name.length > longestCommand) {
                longestCommand = name.length;
            }
        }
        for (const [name, definition] of sortedDefinitions) {
            const spacing = longestCommand - name.length;
            message.push(
                `${HELP_INDENT}${brightMagenta(name)}${" ".repeat(spacing)}${HELP_INDENT}${
                    definition.help
                }`
            );
        }
        const spacing = longestCommand - commandHelpLength;
        message.push(
            `${HELP_INDENT}${dim(commandHelpParts[0])} ${brightCyan(
                commandHelpParts[1]
            )}${" ".repeat(spacing)}${HELP_INDENT}Display help text for a specific command`
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
    help: ["Display Odoo version number"],
});
