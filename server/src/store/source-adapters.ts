import type Database from 'better-sqlite3';

export const SOURCE_ADAPTER_SEEDS = [
  { name: 'local', kind: 'comic', kinds: ['comic'] },
] as const;

export type SourceAdapterRecord = {
  readonly name: string;
  readonly enabled: boolean;
  readonly kind: string;
  readonly kinds: readonly string[];
  readonly config_json: string;
};

type AdapterRow = {
  readonly name: string;
  readonly enabled: number;
  readonly kind: string;
  readonly config_json: string;
};

export function createSourceAdapterTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_adapters (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}'
    )
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO source_adapters (name, enabled, kind, config_json)
    VALUES (@name, 1, @kind, @config)
  `);
  for (const seed of SOURCE_ADAPTER_SEEDS) {
    insert.run({
      name: seed.name,
      kind: seed.kind,
      config: JSON.stringify({ kinds: seed.kinds }),
    });
  }
}

export function listSourceAdapters(db: Database.Database): SourceAdapterRecord[] {
  return (db.prepare(`
    SELECT name, enabled, kind, config_json
    FROM source_adapters
    ORDER BY rowid
  `).all() as AdapterRow[]).map(mapRow);
}

export function getSourceAdapter(db: Database.Database, name: string): SourceAdapterRecord | null {
  const row = db.prepare(`
    SELECT name, enabled, kind, config_json FROM source_adapters WHERE name = ?
  `).get(name) as AdapterRow | undefined;
  return row ? mapRow(row) : null;
}

export function setSourceAdapterEnabled(
  db: Database.Database,
  name: string,
  enabled: boolean,
): SourceAdapterRecord | null {
  const result = db.prepare('UPDATE source_adapters SET enabled = ? WHERE name = ?')
    .run(enabled ? 1 : 0, name);
  if (result.changes === 0) return null;
  return getSourceAdapter(db, name);
}

export function isSourceAdapterEnabled(db: Database.Database, name: string): boolean {
  return getSourceAdapter(db, name)?.enabled === true;
}

function mapRow(row: AdapterRow): SourceAdapterRecord {
  return {
    name: row.name,
    enabled: row.enabled === 1,
    kind: row.kind,
    kinds: parseKinds(row.kind, row.config_json),
    config_json: row.config_json,
  };
}

function parseKinds(kind: string, configJson: string): string[] {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const kinds = (parsed as { kinds?: unknown }).kinds;
      if (Array.isArray(kinds) && kinds.every((item) => typeof item === 'string')) {
        return kinds;
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) return [kind];
    throw error;
  }
  return [kind];
}
