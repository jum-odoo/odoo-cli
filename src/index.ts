import { Command } from "./command";
import { LocalError, RE_FULL_MATCH, RE_SHORT_MATCH } from "./constants";
import { HIGHLIGHT, logger } from "./logger";
import { $, listenOnCloseEvents } from "./process";
import { and, plural, sorted } from "./utils";

import "./commands/index";

const { brightMagenta, brightRed } = HIGHLIGHT;

async function main() {
    listenOnCloseEvents();

    const command = parseArguments(process.argv.slice(2));
    if (Array.isArray(command)) {
        for (const errorMessage of command) {
            logger.error(errorMessage);
        }
        return logger.log("");
    }

    const processErrors = await command.processOptions();
    if (Array.isArray(processErrors)) {
        for (const errorMessage of processErrors) {
            logger.error(errorMessage);
        }
        return logger.log("");
    }

    // If the command requires a port: cleans up the given port
    if (command.hasOption("http-port")) {
        await stopProcessesOnPorts(command.getOptionValues("http-port"));
    }

    // Run command
    await command.run();
}

function parseArguments(args: string[]) {
    const command = Command.find(args);
    if (typeof command === "string") {
        return [command];
    }
    const params: string[] = [];
    const invalidOptions: Set<string> = new Set();
    for (const rawArg of args) {
        if (!rawArg) {
            continue;
        }
        const [arg, argValue] = rawArg.split("=");
        // Check for "full" match
        const fullMatch = arg.match(RE_FULL_MATCH);
        if (fullMatch?.groups?.name) {
            const isValid = command.registerOption(fullMatch.groups.name, "long", [argValue]);
            if (!isValid) {
                invalidOptions.add(fullMatch.groups.name);
            }
            continue;
        }
        // Check for "short" match
        const shortMatch = arg.match(RE_SHORT_MATCH);
        if (shortMatch?.groups?.names) {
            for (const shortOption of shortMatch.groups.names.split("")) {
                const isValid = command.registerOption(shortOption, "short", [argValue]);
                if (!isValid) {
                    invalidOptions.add(shortOption);
                }
            }
            continue;
        }
        // No match: either push value to last option, or to the trailing values
        const lastOption = [...command.options.values()].pop();
        if (lastOption?.acceptsValues) {
            lastOption.values.push(rawArg);
        } else {
            params.push(rawArg);
        }
    }
    if (invalidOptions.size) {
        const list = [...invalidOptions];
        return [
            `unknown ${plural("option", list)} for command ${brightMagenta(command.definition.name)}: ${and(list, brightRed)}`,
        ];
    }
    if (params.length) {
        const { parameters } = command.definition;
        if (!parameters) {
            return [
                `command ${brightMagenta(
                    command.definition.name
                )} does not accept parameters; received: ${and(params, brightRed)}.`,
            ];
        }
        if (parameters.optionName) {
            // Only registers option if specified on parameters;
            // else: trailing values ('params') are simply discarded.
            command.registerOption(parameters.optionName, "long", params);
        }
    }
    return command;
}

async function stopProcessesOnPorts(ports: string[]) {
    const strPorts = sorted(ports).join(",");
    try {
        await $`lsof -ti :${strPorts} | xargs kill -9`;
        logger.info(`terminated existing processes listening on port(s): ${strPorts}`);
    } catch {
        // Command failed: (probably) due to no pIds found
    }
}

try {
    await main();
} catch (err) {
    if (err instanceof LocalError) {
        // Errors caught by this script
        logger.error(err.message, "\n");
    } else {
        throw err;
    }
}
