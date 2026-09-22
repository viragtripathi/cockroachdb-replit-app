export interface QueryResultLike<Row = unknown> {
  rows: Row[];
  rowCount: number | null;
}

export interface PoolClientLike {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<QueryResultLike<Row>>;
  release(): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}
