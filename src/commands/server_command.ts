import { Command } from "../command";
import { START_COMMAND } from "../constants";
import { startServerFromCommand, withDemoData } from "../utils";

Command.register({
    name: START_COMMAND,
    alias: "start",
    defaultArgs: withDemoData,
    options: ["*"],
    defaultOption: "addons",
    async handler(...args) {
        return startServerFromCommand(this, args);
    },
    help: ["Start the given database (default)"],
});
