/** D1 query result returned by the mock prepared statement methods. */
export type MockD1Result<Row> = {
  results: Row[];
  success: boolean;
  meta: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
};

/** Prepared statement mock returned by `MockD1Database.prepare()`. */
export type MockD1PreparedStatement<Row> = {
  readonly sql: string;
  readonly params: unknown[];
  bind(...values: unknown[]): MockD1PreparedStatement<Row>;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<MockD1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
  run(): Promise<MockD1Result<Row>>;
};

/** In-memory D1 database mock with inspectable executed statements. */
export type MockD1Database = {
  readonly statements: Array<{ sql: string; params: unknown[] }>;
  prepare<Row = Record<string, unknown>>(sql: string): MockD1PreparedStatement<Row>;
  batch<Row = Record<string, unknown>>(
    statements: MockD1PreparedStatement<Row>[],
  ): Promise<Array<MockD1Result<Row>>>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
  setResult<Row>(sql: string, rows: Row[]): void;
  clear(): void;
};

/** Create a D1 database mock for tests. Use `setResult()` to seed query rows. */
export function createMockD1Database(): MockD1Database {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const results = new Map<string, unknown[]>();

  const database: MockD1Database = {
    statements,
    prepare<Row = Record<string, unknown>>(sql: string) {
      return createPrepared<Row>(sql, [], statements, results);
    },
    async batch<Row = Record<string, unknown>>(
      batchStatements: MockD1PreparedStatement<Row>[],
    ) {
      const out: Array<MockD1Result<Row>> = [];
      for (const statement of batchStatements) {
        out.push(await statement.run());
      }
      return out;
    },
    async exec(sql) {
      statements.push({ sql, params: [] });
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    setResult<Row>(sql: string, rows: Row[]) {
      results.set(sql, rows);
    },
    clear() {
      statements.splice(0, statements.length);
      results.clear();
    },
  };

  return database;
}

function createPrepared<Row>(
  sql: string,
  params: unknown[],
  statements: Array<{ sql: string; params: unknown[] }>,
  results: Map<string, unknown[]>,
): MockD1PreparedStatement<Row> {
  return {
    sql,
    params,
    bind(...values) {
      return createPrepared<Row>(sql, values, statements, results);
    },
    async first<T = Row>(column?: string) {
      statements.push({ sql, params });
      const row = (results.get(sql)?.[0] as Record<string, unknown> | undefined)
        ?? null;
      if (!row) return null;
      if (!column) return row as T;
      return (row[column] ?? null) as T | null;
    },
    async all<T = Row>() {
      statements.push({ sql, params });
      const rows = (results.get(sql) ?? []) as T[];
      return {
        results: rows,
        success: true,
        meta: {
          duration: 0,
          rows_read: rows.length,
          rows_written: 0,
        },
      };
    },
    async raw<T = unknown[]>() {
      statements.push({ sql, params });
      return (results.get(sql) ?? []) as T[];
    },
    async run() {
      statements.push({ sql, params });
      const rows = (results.get(sql) ?? []) as Row[];
      return {
        results: rows,
        success: true,
        meta: {
          duration: 0,
          rows_read: rows.length,
          rows_written: 0,
        },
      };
    },
  };
}
