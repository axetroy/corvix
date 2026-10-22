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

export class ApplicationStartError extends CorvixError {
  readonly rollbackErrors: readonly unknown[];

  constructor(cause: unknown, rollbackErrors: readonly unknown[] = []) {
    super('Corvix application failed to start', { cause });
    this.rollbackErrors = [...rollbackErrors];
  }
}

export class HookRegistrationError extends CorvixError {}

export class HookExecutionError extends CorvixError {
  readonly hookName: string;
  readonly pluginId: string;

  constructor(hookName: string, pluginId: string, cause: unknown) {
    super(`Handler for hook "${hookName}" failed in plugin "${pluginId}"`, { cause });
    this.hookName = hookName;
    this.pluginId = pluginId;
  }
}

export class EventRegistrationError extends CorvixError {}

export class EventDispatchError extends CorvixError {
  readonly eventName: string;
  readonly failures: readonly { pluginId: string; error: unknown }[];

  constructor(
    eventName: string,
    failures: readonly { pluginId: string; error: unknown }[],
  ) {
    super(`One or more listeners for event "${eventName}" failed`, {
      cause: failures[0]?.error,
    });
    this.eventName = eventName;
    this.failures = [...failures];
  }
}

export class ServiceRegistrationError extends CorvixError {}

export class ServiceNotFoundError extends CorvixError {
  readonly serviceName: string;
  readonly pluginId: string | undefined;
  readonly providerPluginId: string | undefined;

  constructor(
    message: string,
    serviceName: string,
    options: {
      readonly pluginId?: string;
      readonly providerPluginId?: string;
    } = {},
  ) {
    super(message);
    this.serviceName = serviceName;
    this.pluginId = options.pluginId;
    this.providerPluginId = options.providerPluginId;
  }
}

export class DuplicateRegistrationError extends CorvixError {}
