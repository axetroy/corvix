export type EventMapShape<T> = {
  readonly [K in keyof T]: unknown;
};

export interface EventAPI<T> {
  on<
    K extends keyof T & string,
    H extends (payload: T[K]) => void,
  >(
    name: K,
    listener: H & (
      Extract<ReturnType<H>, PromiseLike<unknown>> extends never
        ? unknown
        : never
    ),
  ): () => void;
  emit<K extends keyof T & string>(name: K, payload: T[K]): void;
}

export interface EventEmitter<T> {
  emit<K extends keyof T & string>(name: K, payload: T[K]): void;
}
