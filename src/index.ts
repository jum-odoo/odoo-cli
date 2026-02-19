import { Command } from "./command";
import { LocalError, RE_FULL_MATCH, RE_SHORT_MATCH } from "./constants";
import { HIGHLIGHT, logger } from "./logger";
import { $, listenOnCloseEvents } from "./process";
import { and } from "./utils";

import "./commands/index";

const { brightMagenta, brightRed } = HIGHLIGHT;

async function main() {
    listenOnCloseEvents();

    const processArgs = process.argv.slice(2).flatMap((arg) => arg.split("="));
    const command = parseArguments(processArgs);

    await command.processOptions();

    // If the command requires a port: cleans up the given port
    if (command.options["http-port"]) {
        await stopProcessesOnPorts(command.options["http-port"].values);
    }

    // Run command
    await command.run();
}

function parseArguments(args: string[]) {
    const remainingValues: string[] = [];
    const command = Command.find(args);
    for (const arg of args) {
        let match;
        if ((match = arg.match(RE_FULL_MATCH))) {
            command.registerOption(match.groups!.name, "long");
        } else if ((match = arg.match(RE_SHORT_MATCH))) {
            for (const shortOption of match.groups!.names.split("")) {
                command.registerOption(shortOption, "short");
            }
        } else {
            const lastOption = Object.values(command.options).at(-1);
            if (lastOption?.acceptsValues) {
                lastOption.addValues(arg);
            } else {
                remainingValues.push(arg);
            }
        }
    }
    if (remainingValues.length) {
        if (!command.definition.defaultOption) {
            throw new LocalError(
                `no default option for command ${brightMagenta(
                    command.definition.name
                )}; the following values were given without an option name: ${and(
                    remainingValues,
                    (v) => brightRed(v)
                )}.`
            );
        }
        const option = command.registerOption(command.definition.defaultOption, "long");
        option?.addValues(...remainingValues);
    }
    return command;
}

async function stopProcessesOnPorts(ports: string[]) {
    const strPorts = [...ports].sort().join(",");
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
