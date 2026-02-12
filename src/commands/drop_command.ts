import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { and, dropDatabase, plural } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "drop",
    options: ["database"],
    defaultOption: "database",
    async handler(...args) {
        const dbNames = this.options.database.values;
        logger.info(
            `dropping ${plural("database", dbNames.length, "es")} ${and(dbNames, (name) =>
                brightYellow(name)
            )}`
        );
        await dropDatabase(this, args);
    },
    help: ["Drop the given database"],
});
