declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  }
}
