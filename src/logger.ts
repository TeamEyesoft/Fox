type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, data?: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }) + "\n",
  );
}

export const logger = {
  info(msg: string, data?: Record<string, unknown>): void {
    log("info", msg, data);
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    log("warn", msg, data);
  },
  error(msg: string, data?: Record<string, unknown>): void {
    log("error", msg, data);
  },
};
