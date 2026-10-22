import { satisfies } from 'semver';
import {
  DuplicateRegistrationError,
  ServiceNotFoundError,
  ServiceRegistrationError,
} from '../errors.js';
import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { PluginManifest, PluginState } from '../plugin/types.js';
import type { ServiceAPI } from './types.js';

interface ServiceEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly value: object;
}

export class ServiceRegistry<T> {
  readonly #services = new Map<string, ServiceEntry>();
  readonly #getPluginState: (pluginId: string) => PluginState | undefined;
  readonly #getPluginVersion: (pluginId: string) => string | undefined;

  constructor(
    getPluginState: (pluginId: string) => PluginState | undefined,
    getPluginVersion: (pluginId: string) => string | undefined,
  ) {
    this.#getPluginState = getPluginState;
    this.#getPluginVersion = getPluginVersion;
  }

  createAPI(
    pluginId: string,
    manifest: PluginManifest,
    disposables: DisposableCollection,
  ): ServiceAPI<T> {
    return {
      register: (name, service) => {
        if (this.#getPluginState(pluginId) !== 'activating') {
          throw new ServiceRegistrationError(
            `Plugin "${pluginId}" can only register services during setup`,
          );
        }
        if (typeof service !== 'object' || service === null) {
          throw new ServiceRegistrationError(
            `Service "${String(name)}" must be an object`,
          );
        }
        if (this.#services.has(name)) {
          const existing = this.#services.get(name)!;
          throw new DuplicateRegistrationError(
            `Service "${name}" is already registered by plugin "${existing.pluginId}"`,
          );
        }
        const entry = { pluginId, version: manifest.version, value: service as object };
        this.#services.set(name, entry);
        let disposed = false;
        const dispose = () => {
          if (disposed) {
            return;
          }
          disposed = true;
          if (this.#services.get(name) === entry) {
            this.#services.delete(name);
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
      get: (name) => this.#getForOwner(pluginId, manifest, name, false),
      tryGet: (name) => this.#getForOwner(pluginId, manifest, name, true),
    } as ServiceAPI<T>;
  }

  #getForOwner(
    pluginId: string,
    manifest: PluginManifest,
    name: string,
    optional: boolean,
  ): unknown {
    const state = this.#getPluginState(pluginId);
    if (state !== 'active' && state !== 'activating') {
      throw new ServiceNotFoundError(
        `Plugin "${pluginId}" cannot access services while ${state ?? 'unregistered'}`,
        name,
        { pluginId },
      );
    }
    return this.#get(pluginId, manifest, name, optional);
  }

  #get(
    pluginId: string,
    manifest: PluginManifest,
    name: string,
    optional: boolean,
  ): unknown {
    const entry = this.#services.get(name);
    const providerState = entry && this.#getPluginState(entry.pluginId);
    if (
      !entry
      || (entry.pluginId === pluginId
        ? providerState !== 'activating' && providerState !== 'active'
        : providerState !== 'active')
    ) {
      if (optional) {
        return undefined;
      }
      throw new ServiceNotFoundError(
        `Service "${name}" is not registered or its provider is inactive`,
        name,
        { pluginId },
      );
    }
    if (entry.pluginId !== pluginId) {
      const declaredRange = optional
        ? manifest.optionalDependencies?.[entry.pluginId]
        : manifest.dependencies?.[entry.pluginId];
      if (!declaredRange || !satisfies(entry.version, declaredRange)) {
        if (optional) {
          return undefined;
        }
        throw new ServiceNotFoundError(
          `Plugin "${pluginId}" must declare a compatible required dependency on provider "${entry.pluginId}" to access service "${name}"`,
          name,
          { pluginId, providerPluginId: entry.pluginId },
        );
      }
    }
    if (this.#getPluginVersion(entry.pluginId) !== entry.version) {
      throw new ServiceNotFoundError(
        `Service "${name}" provider "${entry.pluginId}" is no longer registered at the expected version`,
        name,
        { pluginId, providerPluginId: entry.pluginId },
      );
    }
    return new Proxy(entry.value, {
      get: (target, property) => {
        this.#assertAvailable(pluginId, manifest, entry, name, optional);
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== 'function') {
          return value;
        }
        return (...args: unknown[]) => {
          this.#assertAvailable(pluginId, manifest, entry, name, optional);
          return Reflect.apply(value, target, args);
        };
      },
    });
  }

  #assertAvailable(
    pluginId: string,
    manifest: PluginManifest,
    entry: ServiceEntry,
    serviceName: string,
    optional: boolean,
  ): void {
    const ownerState = this.#getPluginState(pluginId);
    const providerState = this.#getPluginState(entry.pluginId);
    const ownerIsActive = ownerState === 'active' || ownerState === 'activating';
    const providerIsActive = entry.pluginId === pluginId
      ? ownerIsActive
      : providerState === 'active';
    if (
      !ownerIsActive
      || !providerIsActive
      || this.#services.get(serviceName) !== entry
      || this.#getPluginVersion(entry.pluginId) !== entry.version
    ) {
      throw new ServiceNotFoundError(
        `Service "${serviceName}" is no longer available to plugin "${pluginId}"`,
        serviceName,
        { pluginId, providerPluginId: entry.pluginId },
      );
    }
    if (entry.pluginId === pluginId) {
      return;
    }
    const declaredRange = optional
      ? manifest.optionalDependencies?.[entry.pluginId]
      : manifest.dependencies?.[entry.pluginId];
    if (!declaredRange || !satisfies(entry.version, declaredRange)) {
      throw new ServiceNotFoundError(
        `Plugin "${pluginId}" must declare a compatible dependency on provider "${entry.pluginId}" to access service "${serviceName}"`,
        serviceName,
        { pluginId, providerPluginId: entry.pluginId },
      );
    }
  }
}
