import { Command } from "../command";
import { startServerFromCommand } from "../utils";

Command.register({
    name: "shell",
    alias: "sh",
    defaultArgs: ["shell"],
    options: [
        "*",
        {
            ["http-port"]: { defaultValues: ["8070"] },
        },
    ],
    defaultOption: "addons",
    async handler(...args) {
        return startServerFromCommand(this, args);
    },
    help: ["Opens the database Python environment in CLI"],
});
