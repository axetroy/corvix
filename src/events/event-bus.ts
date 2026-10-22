import {
  ContractValidationError,
  EventDispatchError,
  EventRegistrationError,
} from '../errors.js';
import { SyncHook } from 'tapable';
import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { PluginState } from '../plugin/types.js';
import type { EventAPI } from './types.js';
import type {
  ExternalEventSchemas,
  RuntimeSchema,
} from '../plugin/types.js';

interface EventListenerEntry {
  readonly pluginId: string;
  readonly listener: (payload: unknown) => unknown;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null)
    || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function';
}

export class EventBus<T> {
  readonly #listeners = new Map<string, EventListenerEntry[]>();
  readonly #getPluginState: (pluginId: string) => PluginState | undefined;
  readonly #schemas: ReadonlyMap<string, RuntimeSchema<unknown>>;

  constructor(
    getPluginState: (pluginId: string) => PluginState | undefined,
    schemas?: ExternalEventSchemas<T>,
  ) {
    this.#getPluginState = getPluginState;
    this.#schemas = new Map(
      Object.entries(schemas ?? {}) as [string, RuntimeSchema<unknown>][],
    );
  }

  createAPI(pluginId: string, disposables: DisposableCollection): EventAPI<T> {
    return {
      on: (name, listener) => {
        if (this.#getPluginState(pluginId) !== 'activating') {
          throw new EventRegistrationError(
            `Plugin "${pluginId}" can only subscribe during setup`,
          );
        }
        if (typeof listener !== 'function') {
          throw new EventRegistrationError(
            `Listener for event "${String(name)}" must be a function`,
          );
        }
        const entries = this.#listeners.get(name) ?? [];
        if (!this.#listeners.has(name)) {
          this.#listeners.set(name, entries);
        }
        const entry: EventListenerEntry = {
          pluginId,
          listener: listener as EventListenerEntry['listener'],
        };
        entries.push(entry);
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
          if (entries.length === 0 && this.#listeners.get(name) === entries) {
            this.#listeners.delete(name);
          }
        };
        try {
          disposables.add(dispose);
        } catch (error) {
          dispose();
          throw error;
        }
        return dispose;
      },
      emit: (name, payload) => {
        const state = this.#getPluginState(pluginId);
        if (state !== 'active' && state !== 'activating') {
          throw new EventRegistrationError(
            `Plugin "${pluginId}" cannot emit events while ${state ?? 'unregistered'}`,
          );
        }
        this.#emit(name, payload);
      },
    } as EventAPI<T>;
  }

  emitFromHost(name: string, payload: unknown): void {
    this.#emit(name, payload);
  }

  emitExternal(name: string, payload: unknown): void {
    const schema = this.#schemas.get(name);
    if (!schema) {
      throw new ContractValidationError(
        'event',
        name,
        new Error(`No runtime schema is registered for event "${name}"`),
      );
    }
    let validated: unknown;
    try {
      validated = schema.parse(payload);
    } catch (cause) {
      throw new ContractValidationError('event', name, cause);
    }
    this.#emit(name, validated);
  }

  #emit(name: string, payload: unknown): void {
    const errors: { pluginId: string; error: unknown }[] = [];
    const hook = new SyncHook<[unknown]>(['payload'], `event:${name}`);
    for (const [index, entry] of [...(this.#listeners.get(name) ?? [])].entries()) {
      hook.tap({ name: `${entry.pluginId}#${index}` }, (eventPayload) => {
        if (this.#getPluginState(entry.pluginId) !== 'active') {
          return;
        }
        try {
          const result = entry.listener(eventPayload);
          if (isPromiseLike(result)) {
            void Promise.resolve(result).catch(() => {});
            throw new TypeError('Event listeners must be synchronous');
          }
        } catch (error) {
          errors.push({ pluginId: entry.pluginId, error });
        }
      });
    }
    hook.call(payload);

    if (errors.length > 0) {
      throw new EventDispatchError(name, errors);
    }
  }
}
