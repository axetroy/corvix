import { HookExecutionError, HookRegistrationError } from '../errors.js';
import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { PluginState } from '../plugin/types.js';
import type {
  BailResult,
  HookAPI,
  HookRegistrationOptions,
  HookRuntimeConfiguration,
} from './types.js';

interface HookEntry {
  readonly pluginId: string;
  readonly sequence: number;
  readonly priority: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly handler: (args: unknown, previous?: unknown) => unknown;
}

interface HookDescriptor {
  readonly mode: 'Sync' | 'AsyncSeries' | 'AsyncParallel';
  readonly strategy: 'series' | 'waterfall' | 'bail';
}

function normalizeIds(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const values = typeof value === 'string' ? [value] : value;
  if (values.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new HookRegistrationError('Hook ordering plugin IDs must be non-empty strings');
  }
  return [...values];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null)
    || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function';
}

function suppressPromiseRejection(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => {});
}

export class HookRegistry<T> {
  readonly #descriptors = new Map<string, HookDescriptor>();
  readonly #entries = new Map<string, HookEntry[]>();
  readonly #getPluginState: (pluginId: string) => PluginState | undefined;
  #sequence = 0;

  constructor(
    configuration: HookRuntimeConfiguration<T> | undefined,
    getPluginState: (pluginId: string) => PluginState | undefined,
  ) {
    this.#getPluginState = getPluginState;
    for (const [name, descriptor] of Object.entries(
      configuration ?? {},
    ) as [string, HookDescriptor][]) {
      if (
        !['Sync', 'AsyncSeries', 'AsyncParallel'].includes(descriptor.mode)
        || !['series', 'waterfall', 'bail'].includes(descriptor.strategy)
        || (descriptor.mode === 'AsyncParallel' && descriptor.strategy !== 'series')
      ) {
        throw new HookRegistrationError(
          `Hook "${name}" has an unsupported mode and strategy combination`,
        );
      }
      this.#descriptors.set(name, descriptor);
      this.#entries.set(name, []);
    }
  }

  createAPI(
    pluginId: string,
    disposables: DisposableCollection,
  ): HookAPI<T> {
    return {
      tap: (name, handler, options) =>
        this.#tap(pluginId, name, handler, disposables, options),
      run: (name, ...args) => {
        const state = this.#getPluginState(pluginId);
        if (state !== 'active' && state !== 'activating') {
          throw new HookRegistrationError(
            `Plugin "${pluginId}" cannot run hooks while ${state ?? 'unregistered'}`,
          );
        }
        return this.#run(name, args[0], args[1]);
      },
    } as HookAPI<T>;
  }

  #tap(
    pluginId: string,
    name: string,
    handler: unknown,
    disposables: DisposableCollection,
    options: HookRegistrationOptions = {},
  ): () => void {
    const descriptor = this.#descriptors.get(name);
    if (!descriptor) {
      throw new HookRegistrationError(`Hook "${name}" is not declared`);
    }
    if (typeof handler !== 'function') {
      throw new HookRegistrationError(`Handler for hook "${name}" must be a function`);
    }
    if (this.#getPluginState(pluginId) !== 'activating') {
      throw new HookRegistrationError(
        `Plugin "${pluginId}" can only register hooks during setup`,
      );
    }
    const priority = options.priority ?? 0;
    if (!Number.isFinite(priority)) {
      throw new HookRegistrationError('Hook priority must be a finite number');
    }

    const entry: HookEntry = {
      pluginId,
      sequence: this.#sequence++,
      priority,
      before: normalizeIds(options.before),
      after: normalizeIds(options.after),
      handler: handler as HookEntry['handler'],
    };
    const entries = this.#entries.get(name)!;
    entries.push(entry);
    try {
      this.#ordered(name);
    } catch (error) {
      entries.pop();
      throw error;
    }

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      const index = entries.indexOf(entry);
      if (index !== -1) {
        entries.splice(index, 1);
      }
    };
    disposables.add(dispose);
    return dispose;
  }

  #ordered(name: string): HookEntry[] {
    const entries = this.#entries.get(name) ?? [];
    const outgoing = new Map(entries.map((entry) => [entry, new Set<HookEntry>()]));
    const incoming = new Map(entries.map((entry) => [entry, 0]));

    for (const entry of entries) {
      for (const other of entries) {
        if (entry === other || entry.pluginId === other.pluginId) {
          continue;
        }
        if (entry.before.includes(other.pluginId)) {
          outgoing.get(entry)!.add(other);
        }
        if (entry.after.includes(other.pluginId)) {
          outgoing.get(other)!.add(entry);
        }
      }
    }
    for (const edges of outgoing.values()) {
      for (const entry of edges) {
        incoming.set(entry, incoming.get(entry)! + 1);
      }
    }

    const compare = (left: HookEntry, right: HookEntry) =>
      right.priority - left.priority || left.sequence - right.sequence;
    const ready = entries.filter((entry) => incoming.get(entry) === 0).sort(compare);
    const ordered: HookEntry[] = [];
    while (ready.length > 0) {
      const entry = ready.shift()!;
      ordered.push(entry);
      for (const next of outgoing.get(entry)!) {
        const nextIncoming = incoming.get(next)! - 1;
        incoming.set(next, nextIncoming);
        if (nextIncoming === 0) {
          ready.push(next);
          ready.sort(compare);
        }
      }
    }

    if (ordered.length !== entries.length) {
      throw new HookRegistrationError(
        `Hook "${name}" has a before/after ordering cycle`,
      );
    }
    return ordered;
  }

  #activeEntries(name: string): HookEntry[] {
    return this.#ordered(name).filter(
      (entry) => this.#getPluginState(entry.pluginId) === 'active',
    );
  }

  #run(name: string, args: unknown, initial?: unknown): unknown {
    const descriptor = this.#descriptors.get(name);
    if (!descriptor) {
      throw new HookRegistrationError(`Hook "${name}" is not declared`);
    }
    const entries = this.#activeEntries(name);

    if (descriptor.mode === 'Sync') {
      if (descriptor.strategy === 'waterfall') {
        let result = initial;
        for (const entry of entries) {
          try {
            const next = entry.handler(args, result);
            if (isPromiseLike(next)) {
              suppressPromiseRejection(next);
              throw new TypeError('Sync hook handlers must not return a Promise');
            }
            result = next;
          } catch (cause) {
            throw new HookExecutionError(name, entry.pluginId, cause);
          }
        }
        return result;
      }
      if (descriptor.strategy === 'bail') {
        for (const entry of entries) {
          try {
            const result = entry.handler(args);
            if (isPromiseLike(result)) {
              suppressPromiseRejection(result);
              throw new TypeError('Sync hook handlers must not return a Promise');
            }
            if (!this.#isBailResult(result)) {
              throw new TypeError('Bail hook handlers must return a bail result');
            }
            if (result.type === 'bail') {
              return result;
            }
          } catch (cause) {
            throw new HookExecutionError(name, entry.pluginId, cause);
          }
        }
        return { type: 'continue' };
      }
      for (const entry of entries) {
        try {
          const result = entry.handler(args);
          if (isPromiseLike(result)) {
            suppressPromiseRejection(result);
            throw new TypeError('Sync hook handlers must not return a Promise');
          }
        } catch (cause) {
          throw new HookExecutionError(name, entry.pluginId, cause);
        }
      }
      return undefined;
    }

    if (descriptor.mode === 'AsyncParallel') {
      return this.#runParallel(name, args, entries);
    }
    return this.#runSeries(name, args, initial, entries, descriptor.strategy);
  }

  async #runParallel(
    name: string,
    args: unknown,
    entries: readonly HookEntry[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await entry.handler(args);
        } catch (cause) {
          throw new HookExecutionError(name, entry.pluginId, cause);
        }
      }),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, `Parallel hook "${name}" failed`);
    }
  }

  async #runSeries(
    name: string,
    args: unknown,
    initial: unknown,
    entries: readonly HookEntry[],
    strategy: HookDescriptor['strategy'],
  ): Promise<unknown> {
    if (strategy === 'waterfall') {
      let result = initial;
      for (const entry of entries) {
        try {
          result = await entry.handler(args, result);
        } catch (cause) {
          throw new HookExecutionError(name, entry.pluginId, cause);
        }
      }
      return result;
    }
    if (strategy === 'bail') {
      for (const entry of entries) {
        let result: unknown;
        try {
          result = await entry.handler(args);
        } catch (cause) {
          throw new HookExecutionError(name, entry.pluginId, cause);
        }
        if (!this.#isBailResult(result)) {
          throw new HookExecutionError(
            name,
            entry.pluginId,
            new TypeError('Bail hook handlers must return a bail result'),
          );
        }
        if (result.type === 'bail') {
          return result;
        }
      }
      return { type: 'continue' };
    }
    for (const entry of entries) {
      try {
        await entry.handler(args);
      } catch (cause) {
        throw new HookExecutionError(name, entry.pluginId, cause);
      }
    }
    return undefined;
  }

  #isBailResult(value: unknown): value is BailResult<unknown> {
    return (
      typeof value === 'object'
      && value !== null
      && 'type' in value
      && ((value as { type: unknown }).type === 'continue'
        || (value as { type: unknown }).type === 'bail')
    );
  }
}
