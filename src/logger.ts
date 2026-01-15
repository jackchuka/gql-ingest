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

/**
 * Creates a console logger with [gql-ingest] prefix.
 * Used when verbose mode is enabled.
 */
export function createConsoleLogger(): Logger {
  return {
    debug: (msg, ...args) => console.debug(`[gql-ingest] ${msg}`, ...args),
    info: (msg, ...args) => console.info(`[gql-ingest] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[gql-ingest] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[gql-ingest] ${msg}`, ...args),
  };
}

/**
 * Creates a default logger based on the verbose flag.
 * Returns no-op logger by default, console logger when verbose is true.
 */
export function createDefaultLogger(verbose = false): Logger {
  return verbose ? createConsoleLogger() : noopLogger;
}
