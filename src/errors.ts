export class CorvixError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class PluginRegistrationError extends CorvixError {}

export class PluginDependencyError extends CorvixError {
  readonly pluginId: string;

  constructor(pluginId: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.pluginId = pluginId;
  }
}

export class PluginActivationError extends CorvixError {
  readonly pluginId: string;
  readonly cleanupErrors: readonly unknown[];

  constructor(
    pluginId: string,
    cause: unknown,
    cleanupErrors: readonly unknown[] = [],
  ) {
    super(`Plugin "${pluginId}" failed to activate`, { cause });
    this.pluginId = pluginId;
    this.cleanupErrors = [...cleanupErrors];
  }
}

export class PluginDeactivationError extends CorvixError {
  readonly pluginId: string;
  readonly errors: readonly unknown[];

  constructor(pluginId: string, errors: readonly unknown[]) {
    super(`Plugin "${pluginId}" failed to deactivate`, {
      cause: errors[0],
    });
    this.pluginId = pluginId;
    this.errors = [...errors];
  }
}
