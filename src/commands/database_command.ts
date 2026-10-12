import { Command } from "../command";
import { LOCAL_HOST } from "../constants";
import { logger } from "../logger";
import { $ } from "../process";
import { getEffectiveHttpPort, startServer } from "../utils";

Command.register({
    name: "database",
    alias: "db",
    forwardUnknownOptions: true,
    options: ["*"],
    async handler(...args) {
        const port = await getEffectiveHttpPort(this);
        await startServer(this, args);
        logger.info("Opening database manager.");
        await $`open ${LOCAL_HOST}:${port}/web/database/manager`;
    },
    help: ["Open the database manager"],
});
