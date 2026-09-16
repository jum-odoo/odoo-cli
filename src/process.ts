import { exec, spawn } from "child_process";
import { HIGHLIGHT, logger } from "./logger";
import { and, plural } from "./utils";

const { brightCyan, brightGreen, cyan, magenta, yellow } = HIGHLIGHT;

export interface SpawnOptions {
    ignoreFail?: boolean;
}

const callExit = (code?: number | NodeJS.Signals) => {
    lastExitCode = code ?? null;
    logger.debug(`${magenta`<exit>`} ${brightCyan(code)}`);
    // `code` is a numeric exit code when called directly, but a signal name
    // (e.g. "SIGINT") when registered as a signal listener below.
    return process.exit(typeof code === "number" ? code : undefined);
};

const onExit = (code: number) => {
    const actualCode = lastExitCode ?? code;
    const time = ((performance.now() - startTime) << 0) / 1000;
    const logs = [
        `Exit code ${brightCyan(actualCode)} received: terminating process (total time: ${yellow(
            time
        )}s)`,
    ];
    if (children.length) {
        logs.push(`${yellow(children.length)} child ${plural("process", children, "es")}`);
        for (const child of children) {
            child.kill();
        }
    }

    logger.debug(and(logs) + ".");
    if (actualCode) {
        logger.info(`Process terminated with code ${brightCyan(actualCode)}.`);
    } else if (children.length) {
        logger.info(`Process ended.`);
    }
};

const children: ReturnType<typeof spawn>[] = [];
let lastExitCode: number | string | null = null;
let startTime = performance.now();

function quoteShellArg(value: unknown): string {
    return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

export async function $(strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
    // Only the literal parts of the template are used verbatim (so shell syntax
    // such as `&&` or `|` written directly in a command still works); every
    // interpolated value is shell-quoted so it can never be interpreted as
    // additional shell syntax (e.g. a database name containing `;` or `` ` ``).
    let command = strings[0];
    for (let i = 0; i < values.length; i++) {
        command += quoteShellArg(values[i]) + strings[i + 1];
    }
    logger.debug(`${magenta`<exec>`} ${cyan(command)}`);
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                if (stderr) {
                    logger.debug(stderr);
                }
                resolve(stdout.trim());
            }
        });
    });
}

export function listenOnCloseEvents() {
    process.on("exit", onExit);

    process.on("SIGINT", callExit); // CTRL+C
    process.on("SIGQUIT", callExit); // Keyboard quit
    process.on("SIGTERM", callExit); // `kill` command

    process.on("SIGUSR1", callExit);
    process.on("SIGUSR2", callExit);
}

export function spawnProcess(args: string[], options?: SpawnOptions) {
    const { ignoreFail } = options || {};
    const command = args.shift() || "";
    logger.debug(`${magenta`<spawn>`} ${brightGreen(command)} ${args.map(cyan).join(" ")}`);
    const child = spawn(command, args, { stdio: ignoreFail ? "pipe" : "inherit" });
    child.stdout?.on("data", (chunk) => logger.info(String(chunk)));
    const log = ignoreFail ? logger.info : logger.error;
    child.stderr?.on("data", (chunk) => log(String(chunk)));
    children.push(child);
    return new Promise((resolve, reject) => {
        child.on("error", (error) => reject(error));
        child.on("exit", (code) => {
            if (code && !ignoreFail) {
                reject(code);
            } else {
                resolve(code);
            }
        });
    });
}
