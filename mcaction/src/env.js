import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({
  path: [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.mcaction', '.env'),
    path.join(ROOT, '.env'),
  ],
});
