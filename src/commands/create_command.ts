import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import { and, dropDatabase, mapped, plural, warnError, withDemoData } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "create",
    defaultArgs: withDemoData,
    parameters: {
        name: "database name(s)",
        optionName: "database",
    },
    options: ["*"],
    async handler(...args) {
        const dbNames = this.getOptionValues("database");
        // Drop
        await dropDatabase(this, args);
        logger.info(
            `Creating new ${plural("database", dbNames, "es")} ${and(dbNames, brightYellow)}.`
        );
        // Create
        await Promise.all(mapped(dbNames, (dbName) => $`createdb ${dbName}`.catch(warnError)));
    },
    help: ["Create or overwrite a new database."],
});
