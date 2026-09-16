import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { and, dropDatabase, plural } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "drop",
    options: ["database"],
    parameters: {
        name: "database name(s)",
        optionName: "database",
    },
    async handler(...args) {
        const dbNames = this.getOptionValues("database");
        logger.info(`Dropping ${plural("database", dbNames, "es")} ${and(dbNames, brightYellow)}.`);
        await dropDatabase(this, args);
    },
    help: ["Drop the given database"],
});
