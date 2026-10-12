import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import {
    and,
    dropDatabase,
    getEffectiveDatabase,
    mapped,
    plural,
    warnError,
    withDemoData,
} from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "create",
    defaultArgs: withDemoData,
    parameters: {
        name: "database name(s)",
        optionName: "database",
    },
    options: ["database"],
    async handler() {
        const dbNames = await getEffectiveDatabase(this);
        // Drop
        await dropDatabase(this);
        logger.info(
            `Creating new ${plural("database", dbNames, "es")} ${and(dbNames, brightYellow)}.`
        );
        // Create
        await Promise.all(mapped(dbNames, (dbName) => $`createdb ${dbName}`.catch(warnError)));
    },
    help: ["Create or overwrite a new database."],
});
