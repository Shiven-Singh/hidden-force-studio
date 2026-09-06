/**
 * Loads the repo-root .env if present, before any module reads process.env.
 * Import this first in every entry point. No dependency: Node 22 ships
 * process.loadEnvFile. Cloud Run sets real env vars and has no .env file.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}
