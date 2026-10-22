import { EventDispatchError, EventRegistrationError } from '../errors.js';
import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { PluginState } from '../plugin/types.js';
import type { EventAPI } from './types.js';

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

  constructor(getPluginState: (pluginId: string) => PluginState | undefined) {
    this.#getPluginState = getPluginState;
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

  #emit(name: string, payload: unknown): void {
    const errors: { pluginId: string; error: unknown }[] = [];
    for (const entry of [...(this.#listeners.get(name) ?? [])]) {
      if (this.#getPluginState(entry.pluginId) !== 'active') {
        continue;
      }
      try {
        const result = entry.listener(payload);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError('Event listeners must be synchronous');
        }
      } catch (error) {
        errors.push({ pluginId: entry.pluginId, error });
      }
    }

    if (errors.length > 0) {
      throw new EventDispatchError(name, errors);
    }
  }
}
