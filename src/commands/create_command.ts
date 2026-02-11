import { Command } from "../command";
import { HIGHLIGHT, logger } from "../logger";
import { $ } from "../process";
import { dropDatabase, startServer, warnError } from "../utils";

const { brightYellow } = HIGHLIGHT;

Command.register({
    name: "create",
    defaultArgs: ["--with-demo", "--without-demo=False"],
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
    async handler(command, args) {
        const dbName = command.options.database.values.join(" ");
        logger.info(
            `creating new database ${brightYellow(dbName)} (${
                command.options.start ? "with" : "without"
            } auto-start)`
        );
        // Drop
        await dropDatabase(command, args);
        if (command.options.start) {
            // Autostart
            startServer(command, args);
        } else {
            // Create
            await $`createdb ${dbName}`.catch(warnError);
        }
    },
    help: ["Create or overwrite a new database."],
});
