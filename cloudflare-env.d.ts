interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { changes: number } }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<{ meta: { changes: number } }[]>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
/** The subset of the R2 bucket binding the app uses. */
interface BucketObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}
interface BucketListing {
  objects: { key: string }[];
  truncated: boolean;
  cursor?: string;
}
interface Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<BucketObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<BucketListing>;
}
declare module 'cloudflare:workers' {
  export const env: {
    DB: D1Database;
    BUCKET: Bucket;
  };
}
