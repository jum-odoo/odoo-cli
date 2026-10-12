import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { and, dropDatabase, getEffectiveDatabase, plural } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "drop",
    options: ["database"],
    parameters: {
        name: "database name(s)",
        optionName: "database",
    },
    async handler() {
        const dbNames = await getEffectiveDatabase(this);
        logger.info(`Dropping ${plural("database", dbNames, "es")} ${and(dbNames, brightYellow)}.`);
        await dropDatabase(this);
    },
    help: ["Drop the given database"],
});
