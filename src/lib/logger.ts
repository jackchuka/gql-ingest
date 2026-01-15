/**
 * Logger interface for configurable logging
 *
 * Libraries should be quiet by default unless explicitly configured.
 */
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * No-op logger that silently discards all log messages.
 * Used as the default logger to keep the library quiet.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface ConsoleLoggerOptions {
  prefix?: string;
}

/**
 * Creates a console logger with optional prefix.
 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const { prefix } = options;
  const fmt = (msg: string) => (prefix ? `[${prefix}] ${msg}` : msg);

  return {
    debug: (msg, ...args) => console.debug(fmt(msg), ...args),
    info: (msg, ...args) => console.info(fmt(msg), ...args),
    warn: (msg, ...args) => console.warn(fmt(msg), ...args),
    error: (msg, ...args) => console.error(fmt(msg), ...args),
  };
}

/**
 * Creates a default logger based on the verbose flag.
 * Returns no-op logger by default, console logger when verbose is true.
 */
export function createDefaultLogger(verbose = false): Logger {
  return verbose ? createConsoleLogger() : noopLogger;
}
