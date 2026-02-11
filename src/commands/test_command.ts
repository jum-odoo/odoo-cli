import { Command } from "../command";
import { startServerFromCommand } from "../utils";

Command.register({
    name: "test",
    defaultArgs: ["--log-level", "test", "--stop-after-init", "--test-enable"],
    options: [
        "*",
        {
            tags: {
                flag: "--test-tags",
                short: "tag",
                required: true,
                help: [
                    "Comma-separated list of specs to filter which tests to execute. Enable unit tests if set",
                ],
            },
        },
    ],
    defaultOption: "tags",
    handler: startServerFromCommand,
    help: ["Run Python tests"],
});
