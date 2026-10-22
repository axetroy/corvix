export type ServiceMapShape<T> = {
  readonly [K in keyof T]: object;
};

export interface ServiceAPI<T> {
  register<K extends keyof T & string>(name: K, service: T[K]): () => void;
  get<K extends keyof T & string>(name: K): T[K];
  tryGet<K extends keyof T & string>(name: K): T[K] | undefined;
}
