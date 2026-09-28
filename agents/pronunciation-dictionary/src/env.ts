import "dotenv/config";

/** Reads a required variable from the environment or .env, exiting with a clear message if unset. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

/** Reads an optional variable, falling back to `fallback` when unset or blank. */
export function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}
