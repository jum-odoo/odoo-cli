import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { dropDatabase, plural } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "drop",
    options: ["database"],
    defaultOption: "database",
    async handler(command, args) {
        const dbNames = command.options.database.values;
        logger.info(
            `dropping ${plural("database", dbNames.length)} ${dbNames
                .map((name) => brightYellow(name))
                .join(", ")}`
        );
        await dropDatabase(command, args);
    },
    help: ["Drop the given database"],
});
