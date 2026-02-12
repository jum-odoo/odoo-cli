import { isDebug } from "./constants";

export type Highlighter = {
    (
        template:
            | string
            | number
            | null
            | undefined
            | { raw: readonly string[] | ArrayLike<string> },
        ...substitutions: any[]
    ): string;
    (...strings: string[]): string;
};

function makeHighlighter(...styles: (keyof typeof CONSOLE_HIGHLIGHTS)[]): Highlighter {
    const styleStr = styles.map((style) => CONSOLE_HIGHLIGHTS[style]).join("");
    return function wrapColor(template, ...substitutions) {
        const str =
            template && typeof template === "object"
                ? String.raw(template, substitutions)
                : [template, ...substitutions].join(" ");
        return styleStr + str + CONSOLE_HIGHLIGHTS.reset;
    };
}

function timestamp(): string {
    return new Date().toISOString().slice(11, 23);
}

/**
 * Variables not in use have been commented.
 */
const CONSOLE_HIGHLIGHTS = {
    // Style
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    // italic: "\x1b[3m",
    // underscore: "\x1b[4m",
    // slowBlink: "\x1b[5m",
    // rapidBlink: "\x1b[6m",
    // reverse: "\x1b[7m",
    // hidden: "\x1b[8m",
    // strike: "\x1b[9m",

    // Text colors
    // black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    // white: "\x1b[37m",

    // Bright text colors
    // brightBlack: "\x1b[90m",
    // brightRed: "\x1b[91m",
    // brightGreen: "\x1b[92m",
    // brightYellow: "\x1b[93m",
    // brightBlue: "\x1b[94m",
    // brightMagenta: "\x1b[95m",
    // brightCyan: "\x1b[96m",
    // brightWhite: "\x1b[97m",
};

class Logger {
    debug(...args: any[]) {
        isDebug() && console.debug(timestamp(), HIGHLIGHT.brightMagenta`[#]`, ...args);
    }

    error(...args: any[]) {
        console.error(timestamp(), HIGHLIGHT.brightRed`[x]`, ...args);
    }

    info(...args: any[]) {
        console.log(timestamp(), HIGHLIGHT.brightBlue`[i]`, ...args);
    }

    log(...args: any[]) {
        console.log(...args);
    }

    warn(...args: any[]) {
        console.warn(timestamp(), HIGHLIGHT.brightYellow`[!]`, ...args);
    }
}

export const HIGHLIGHT = {
    // Premade helpers
    brightBlue: makeHighlighter("bold", "blue"),
    brightCyan: makeHighlighter("bold", "cyan"),
    brightGreen: makeHighlighter("bold", "green"),
    brightMagenta: makeHighlighter("bold", "magenta"),
    brightRed: makeHighlighter("bold", "red"),
    brightYellow: makeHighlighter("bold", "yellow"),
    cyan: makeHighlighter("cyan"),
    dim: makeHighlighter("dim"),
    magenta: makeHighlighter("magenta"),
    yellow: makeHighlighter("yellow"),
};

export const logger = new Logger();
