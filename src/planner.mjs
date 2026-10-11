import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class MigrationPlanner {
  constructor(api, directory) { this.api = api; this.directory = directory; }
}
