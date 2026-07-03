/**
 * Structured JSON logging in the shape Cloud Logging parses natively
 * (severity + message + arbitrary labels). No log library needed.
 */
type Fields = Record<string, unknown>;

function emit(severity: "DEBUG" | "INFO" | "WARNING" | "ERROR", message: string, fields?: Fields): void {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

export const log = {
  debug: (message: string, fields?: Fields) => emit("DEBUG", message, fields),
  info: (message: string, fields?: Fields) => emit("INFO", message, fields),
  warn: (message: string, fields?: Fields) => emit("WARNING", message, fields),
  error: (message: string, fields?: Fields) => emit("ERROR", message, fields),
};
