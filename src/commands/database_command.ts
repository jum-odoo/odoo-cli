import { Command } from "../command";
import { LOCAL_HOST } from "../constants";
import { logger } from "../logger";
import { $ } from "../process";
import { startServer } from "../utils";

Command.register({
    name: "database",
    alias: "db",
    options: ["http-port"],
    async handler(...args) {
        const [port] = this.options["http-port"].values || [];
        await startServer(this, args);
        logger.info("Opening database manager");
        await $`open ${LOCAL_HOST}:${port}/web/database/manager`;
    },
    help: ["Open the database manager"],
});
