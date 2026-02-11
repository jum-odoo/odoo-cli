import { Command } from "../command";
import { START_COMMAND } from "../constants";
import { startServerFromCommand } from "../utils";

Command.register({
    name: START_COMMAND,
    alias: "start",
    defaultArgs: ["--with-demo", "--without-demo=False"],
    options: ["*"],
    defaultOption: "addons",
    handler: startServerFromCommand,
    help: ["Start the given database (default)"],
});
