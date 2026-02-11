import { exec, spawn } from "child_process";
import { HIGHLIGHT, logger } from "./logger";
import { plural } from "./utils";

const { brightCyan, brightGreen, cyan, magenta, yellow } = HIGHLIGHT;

export interface SpawnOptions {
    ignoreFail?: boolean;
}

const callExit: typeof process.exit = (code) => {
    lastExitCode = code ?? null;
    logger.debug(`${magenta`<exit>`} ${brightCyan(code)}`);
    const nCode = Number(lastExitCode);
    return process.exit(Number.isInteger(nCode) ? nCode : null);
};

const onExit = (code: number) => {
    const actualCode = lastExitCode ?? code;
    const time = ((performance.now() - startTime) << 0) / 1000;
    const logs = [
        `exit code ${brightCyan(actualCode)} received: terminating process (total time: ${yellow(
            time
        )}s)`,
    ];
    if (children.length) {
        logs.push(
            `and ${yellow(children.length)} child ${plural("process", children.length, "es")}`
        );
        for (const child of children) {
            child.kill();
        }
    }

    logger.debug(...logs);
    if (actualCode) {
        logger.info(`process terminated with code ${brightCyan(actualCode)}`);
    } else if (children.length) {
        logger.info(`process ended`);
    }
};

const children: ReturnType<typeof spawn>[] = [];
let lastExitCode: number | string | null = null;
let startTime = performance.now();

export async function $(...args: Parameters<typeof String.raw>): Promise<string> {
    const command = String.raw(...args);
    logger.debug(`${magenta`<exec>`} ${cyan(command)}`);
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error || stderr) {
                reject(error || stderr);
            } else {
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
    logger.debug(`${magenta`<spawn>`} ${brightGreen(command)} ${cyan(...args)}`);
    const child = spawn(command, args, { stdio: ignoreFail ? "pipe" : "inherit" });
    child.stdout?.on("data", logger.info);
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
