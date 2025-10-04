/* eslint-disable no-console */
export const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  warn: (message: string) => console.warn(`[WARN] ${message}`),
  error: (message: string, error?: unknown) => {
    if (error instanceof Error) {
      console.error(`[ERROR] ${message}: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    } else if (error) {
      console.error(`[ERROR] ${message}:`, error);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },
  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`);
    }
  },
};
