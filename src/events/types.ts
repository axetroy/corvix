export type EventMapShape<T> = {
  readonly [K in keyof T]: unknown;
};

export interface EventAPI<T> {
  on<K extends keyof T & string>(
    name: K,
    listener: (payload: T[K]) => void,
  ): () => void;
  emit<K extends keyof T & string>(name: K, payload: T[K]): void;
}
