import { PluginRegistrationError } from '../errors.js';
import { noopLogger } from '../logging/logger.js';
import { PluginManager } from '../plugin/plugin-manager.js';
import { EventBus } from '../events/event-bus.js';
import { HookRegistry } from '../hooks/hook-registry.js';
import { ServiceRegistry } from '../services/service-registry.js';
import type { EventMapShape } from '../events/types.js';
import type { HookMapShape } from '../hooks/types.js';
import type { ServiceMapShape } from '../services/types.js';
import type {
  CorvixApplicationOptions,
  PluginDefinition,
  PluginState,
} from '../plugin/types.js';

export type ApplicationState = 'stopped' | 'starting' | 'running' | 'stopping';

export class CorvixApplication<
  TEvents extends EventMapShape<TEvents> = Record<never, never>,
  THooks extends HookMapShape<THooks> = Record<never, never>,
  TServices extends ServiceMapShape<TServices> = Record<never, never>,
> {
  readonly #pluginManager: PluginManager<TEvents, THooks, TServices>;
  #state: ApplicationState = 'stopped';
  #queue: Promise<void> = Promise.resolve();
  #startPromise: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;
  readonly #retryPromises = new Map<string, Promise<void>>();

  constructor(options: CorvixApplicationOptions<THooks>) {
    const managerRef: {
      current?: PluginManager<TEvents, THooks, TServices>;
    } = {};
    const getPluginState = (pluginId: string) =>
      managerRef.current?.getState(pluginId);
    const hookRegistry = new HookRegistry<THooks>(
      options.hooks,
      getPluginState,
    );
    const eventBus = new EventBus<TEvents>(getPluginState);
    const serviceRegistry = new ServiceRegistry<TServices>(
      getPluginState,
      (pluginId) => managerRef.current?.getPluginVersion(pluginId),
    );
    const pluginManager = new PluginManager({
      apiVersion: options.apiVersion,
      logger: options.logger ?? noopLogger,
      hooks: hookRegistry,
      events: eventBus,
      services: serviceRegistry,
    });
    managerRef.current = pluginManager;
    this.#pluginManager = pluginManager;
  }

  get state(): ApplicationState {
    return this.#state;
  }

  register(plugin: PluginDefinition<TEvents, THooks, TServices>): void {
    if (
      this.#state !== 'stopped'
      || this.#startPromise
      || this.#stopPromise
      || this.#retryPromises.size > 0
    ) {
      throw new PluginRegistrationError(
        'Plugins can only be registered while the application is stopped',
      );
    }
    this.#pluginManager.register(plugin);
  }

  getPluginState(pluginId: string): PluginState | undefined {
    return this.#pluginManager.getState(pluginId);
  }

  start(): Promise<void> {
    if (this.#startPromise) {
      return this.#startPromise;
    }
    if (!this.#stopPromise && this.#state === 'running') {
      return Promise.resolve();
    }

    const operation = this.#queue.then(async () => {
      if (this.#state === 'running') {
        return;
      }

      this.#state = 'starting';
      try {
        await this.#pluginManager.start();
        this.#state = 'running';
      } catch (error) {
        this.#state = 'stopped';
        throw error;
      }
    });
    this.#enqueue(operation);
    this.#startPromise = operation;
    this.#clearWhenSettled(operation, () => {
      this.#startPromise = undefined;
    });
    return operation;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) {
      return this.#stopPromise;
    }
    if (
      !this.#startPromise
      && this.#retryPromises.size === 0
      && this.#state === 'stopped'
      && !this.#pluginManager.hasActivePlugins
    ) {
      return Promise.resolve();
    }

    const operation = this.#queue.then(async () => {
      if (this.#state === 'stopped' && !this.#pluginManager.hasActivePlugins) {
        return;
      }

      this.#state = 'stopping';
      try {
        await this.#pluginManager.stop();
      } finally {
        this.#state = 'stopped';
      }
    });
    this.#enqueue(operation);
    this.#stopPromise = operation;
    this.#clearWhenSettled(operation, () => {
      this.#stopPromise = undefined;
    });
    return operation;
  }

  retryPlugin(pluginId: string): Promise<void> {
    const pendingRetry = this.#retryPromises.get(pluginId);
    if (pendingRetry) {
      return pendingRetry;
    }

    const operation = this.#queue.then(async () => {
      if (this.#state !== 'stopped') {
        throw new PluginRegistrationError(
          'A failed plugin can only be retried while the application is stopped',
        );
      }

      this.#state = 'starting';
      try {
        await this.#pluginManager.retry(pluginId);
        await this.#pluginManager.start();
        this.#state = 'running';
      } catch (error) {
        this.#state = 'stopped';
        throw error;
      }
    });
    this.#enqueue(operation);
    this.#retryPromises.set(pluginId, operation);
    this.#clearWhenSettled(operation, () => {
      this.#retryPromises.delete(pluginId);
    });
    return operation;
  }

  #enqueue(operation: Promise<void>): void {
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
  }

  #clearWhenSettled(
    operation: Promise<void>,
    cleanup: () => void,
  ): void {
    void operation.then(cleanup, cleanup);
  }
}
