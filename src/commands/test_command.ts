import { Command } from "../command";
import { startServerFromCommand } from "../utils";

Command.register({
    name: "test",
    defaultArgs: ["--log-level", "test", "--stop-after-init", "--test-enable"],
    options: [
        "*",
        {
            ["test-tags"]: {
                flag: true,
                short: "tag",
                required: true,
                help: [
                    "Comma-separated list of specs to filter which tests to execute. Enable unit tests if set",
                ],
            },
        },
    ],
    defaultOption: "test-tags",
    async handler(...args) {
        return startServerFromCommand(this, args);
    },
    help: ["Run Python tests"],
});
