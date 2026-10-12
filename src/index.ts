import { Command } from "./command";
import { LocalError, RE_FULL_MATCH, RE_SHORT_MATCH } from "./constants";
import { HIGHLIGHT, logger } from "./logger";
import { $, listenOnCloseEvents } from "./process";
import { and, getEffectiveHttpPort, plural, sorted } from "./utils";

import "./commands/index";

const { brightMagenta, brightRed } = HIGHLIGHT;

async function main() {
    listenOnCloseEvents();

    const command = parseArguments(process.argv.slice(2));

    await command.processOptions();

    // If the command supports a port (whether given, defaulted from odoo.conf, or hardcoded):
    // cleans up whatever is already listening on it
    if (command.definition.options.some((option) => option.name === "http-port")) {
        await stopProcessesOnPorts([await getEffectiveHttpPort(command)]);
    }

    // Run command
    await command.run();
}

function parseArguments(args: string[]) {
    const command = Command.find(args);
    const params: string[] = [];
    const invalidOptions: Set<string> = new Set();
    for (const rawArg of args) {
        if (!rawArg) {
            continue;
        }
        const eqIndex = rawArg.indexOf("=");
        const arg = eqIndex < 0 ? rawArg : rawArg.slice(0, eqIndex);
        const argValue = eqIndex < 0 ? "" : rawArg.slice(eqIndex + 1);
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
        // No match: either push value to last option, or to the trailing values. A forwarded
        // (unrecognized, passed-through) option never absorbs a following bare value this way —
        // we don't know if it's a boolean odoo-bin flag or a value one, so only `--name=value`
        // is supported for those; a bare token after one falls through as a positional/param.
        const lastOption = [...command.options.values()].pop();
        if (lastOption?.acceptsValues && !lastOption.definition.forwarded) {
            lastOption.values.push(rawArg);
        } else {
            params.push(rawArg);
        }
    }
    if (invalidOptions.size) {
        const list = [...invalidOptions];
        throw new LocalError(
            `unknown ${plural("option", list)} for command ${brightMagenta(command.definition.name)}: ${and(list, brightRed)}.`
        );
    }
    if (params.length) {
        const { parameters } = command.definition;
        if (!parameters) {
            throw new LocalError(
                `command ${brightMagenta(
                    command.definition.name
                )} does not accept parameters; received: ${and(params, brightRed)}.`
            );
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
        logger.info(`Terminated existing processes listening on port(s): ${strPorts}.`);
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
