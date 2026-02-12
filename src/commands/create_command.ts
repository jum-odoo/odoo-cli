import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import { and, dropDatabase, plural, startServer, warnError, withDemoData } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "create",
    defaultArgs: withDemoData,
    options: [
        "*",
        {
            start: {
                standalone: true,
                help: ["Start the database after creation."],
            },
        },
    ],
    defaultOption: "database",
    async handler(...args) {
        const dbNames = this.options.database.values;
        logger.info(
            `creating new ${plural("database", dbNames.length, "es")} ${and(dbNames, (name) =>
                brightYellow(name)
            )} (${this.options.start ? "with" : "without"} auto-start)`
        );
        // Drop
        await dropDatabase(this, args);
        if (this.options.start) {
            // Autostart
            startServer(this, args);
        } else {
            // Create
            await Promise.all(dbNames.map((dbName) => $`createdb ${dbName}`.catch(warnError)));
        }
    },
    help: ["Create or overwrite a new database."],
});
