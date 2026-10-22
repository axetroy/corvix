export type HookMode = 'Sync' | 'AsyncSeries' | 'AsyncParallel';
export type HookStrategy = 'series' | 'waterfall' | 'bail';

export interface HookContract {
  readonly args: unknown;
  readonly mode: HookMode;
  readonly strategy: HookStrategy;
  readonly result?: unknown;
}

export type HookMapShape<T> = {
  readonly [K in keyof T]: HookContract;
};

export type EmptyContractMap = Record<never, never>;

export type HookArguments<T> = T extends { readonly args: infer TArgs }
  ? TArgs
  : never;

export type HookResult<T> = T extends {
  readonly strategy: 'waterfall';
  readonly result: infer TResult;
}
  ? TResult
  : T extends { readonly strategy: 'bail'; readonly result: infer TResult }
    ? BailResult<TResult>
    : void;

export type BailResult<TResult> =
  | { readonly type: 'continue' }
  | { readonly type: 'bail'; readonly value: TResult };

export type HookRunArguments<T> = T extends {
  readonly strategy: 'waterfall';
  readonly result: infer TResult;
}
  ? [args: HookArguments<T>, initial: TResult]
  : [args: HookArguments<T>];

export type HookRunReturn<T> = T extends { readonly mode: 'Sync' }
  ? HookResult<T>
  : Promise<HookResult<T>>;

export type HookHandler<T> = T extends {
  readonly strategy: 'waterfall';
  readonly result: infer TResult;
}
  ? (
    args: HookArguments<T>,
    previous: TResult,
  ) => TResult | Promise<TResult>
  : T extends { readonly strategy: 'bail'; readonly result: infer TResult }
    ? (
      args: HookArguments<T>,
    ) => BailResult<TResult> | Promise<BailResult<TResult>>
    : T extends { readonly mode: 'Sync' }
      ? (args: HookArguments<T>) => void
      : (args: HookArguments<T>) => void | Promise<void>;

export interface HookRegistrationOptions {
  readonly priority?: number;
  readonly before?: string | readonly string[];
  readonly after?: string | readonly string[];
}

export type HookRuntimeConfiguration<T> = {
  readonly [K in keyof T]: T[K] extends {
    readonly mode: infer TMode extends HookMode;
    readonly strategy: infer TStrategy extends HookStrategy;
  }
    ? {
      readonly mode: TMode;
      readonly strategy: TStrategy;
    }
    : never;
};

export interface HookAPI<T> {
  tap<K extends keyof T & string>(
    name: K,
    handler: HookHandler<T[K]>,
    options?: HookRegistrationOptions,
  ): () => void;
  run<K extends keyof T & string>(
    name: K,
    ...args: HookRunArguments<T[K]>
  ): HookRunReturn<T[K]>;
}
