# Corvix API reference

The package root (`corvix`) is the supported public entry point. Internal `src/` modules are implementation details and are not covered by the compatibility policy.

## Application

Create an application with a SemVer `apiVersion`, optional Hook runtime configuration, logger, and host runtime options. The generic parameters are event contracts, Hook contracts, service contracts, host capabilities, and runtime configuration, in that order.

- `register(plugin)` registers a plugin while the application is stopped.
- `start()` activates plugins in dependency order. Repeated calls while running are no-ops; failed starts reject with `ApplicationStartError` and roll back activated plugins.
- `stop()` deactivates active plugins in reverse activation order and disposes resources.
- `retryPlugin(id)` retries a failed plugin and resumes startup.
- `state` reports `stopped`, `starting`, `running`, or `stopping`.
- `hooks.run(name, ...args)` executes a configured Hook while running.
- `events.emit(name, payload)` publishes an already typed, trusted host event while running.
- `events.emitExternal(name, payload)` validates an untrusted payload with the configured event schema before dispatch.

## Plugins and lifecycle

A plugin has a `manifest`, a required `setup(context)` callback, and an optional `deactivate(context)` callback. Its manifest declares a unique ID, plugin SemVer version, compatible Corvix API version range, and optional required/optional plugin dependencies.

`PluginContext` provides the plugin ID, logger, `DisposableCollection`, typed Hook/Event/Service APIs, and host runtime. Register resource cleanup immediately with `context.disposables`; cleanup runs on failed activation rollback and deactivation. Registrations made through the context are automatically removed when the plugin is deactivated.

Plugins can subscribe with `context.events.on`, publish typed events with `context.events.emit`, register/get services with `context.services`, and add Hook handlers with `context.hooks.tap`. Access to another plugin's service requires a compatible dependency declaration and is guarded by provider and consumer lifecycle.

## Host contracts

`host.capabilities` contains host-provided APIs and `host.configuration` contains host-supplied configuration, validated when a schema is provided. Both are exposed as shallow readonly snapshots on `context.host`.

`RuntimeSchema<T>` is the minimal validation contract: implement `parse(input: unknown): T`, returning a validated value or throwing. A `configurationSchema` validates configuration during application construction. Each `eventSchemas` entry validates the matching event before `emitExternal` dispatches it. Missing event schemas and parser failures throw `ContractValidationError`.

## Errors

- `ApplicationStartError`: startup failure, original `cause`, and `rollbackErrors`.
- `PluginActivationError` / `PluginDeactivationError`: plugin ID and activation/cleanup or teardown failures.
- `PluginDependencyError`: plugin dependency or API-range resolution failure.
- `HookExecutionError`: Hook and plugin context for handler failure.
- `EventDispatchError`: event name and failures grouped by listener plugin.
- `ServiceNotFoundError`: unavailable service and consumer/provider context.
- Registration errors (`PluginRegistrationError`, `HookRegistrationError`, `EventRegistrationError`, `ServiceRegistrationError`, `DuplicateRegistrationError`): invalid or unavailable registration/use.
- `ContractValidationError`: invalid external configuration or event input.

## Version and compatibility policy

The root exports and this reference define the public API. Changes to internal paths are not compatibility guarantees. Plugin `manifest.apiVersion` is a SemVer range and must include the host's `apiVersion`; plugin dependency ranges are checked against registered plugin versions.

Before Corvix 1.0.0, a minor release may introduce a breaking public API change, while patch releases are reserved for backward-compatible fixes. The package version and `apiVersion` are separate: the package version describes Corvix releases, while `apiVersion` describes the runtime contract plugins target. A future 1.0.0 release will adopt SemVer's stable-major compatibility guarantees.
