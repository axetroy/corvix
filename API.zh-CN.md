# Corvix API 参考

包根入口（`corvix`）是受支持的公共入口。内部 `src/` 路径属于实现细节，不在兼容性承诺范围内。

## 应用

创建应用时可传入 SemVer 格式的 `apiVersion`、可选 Hook 运行时配置、Logger 和宿主运行时选项。泛型参数依次为事件契约、Hook 契约、Service 契约、宿主能力和运行时配置。

- `register(plugin)` 在应用停止时注册插件。
- `start()` 按依赖顺序激活插件。应用运行时重复调用不会重复启动；启动失败会回滚已激活插件并抛出 `ApplicationStartError`。
- `stop()` 按激活顺序逆序停用插件并清理资源。
- `retryPlugin(id)` 重试失败的插件并恢复启动。
- `state` 返回 `stopped`、`starting`、`running` 或 `stopping`。
- `hooks.run(name, ...args)` 在应用运行时执行已配置的 Hook。
- `events.emit(name, payload)` 在应用运行时发布类型已知且可信的宿主事件。
- `events.emitExternal(name, payload)` 使用事件 Schema 验证不可信负载后再派发。

## 插件与生命周期

插件包含 `manifest`、必需的 `setup(context)` 回调及可选的 `deactivate(context)` 回调。Manifest 声明唯一 ID、插件 SemVer 版本、兼容的 Corvix API 版本范围，以及可选的必需/可选插件依赖。

`PluginContext` 提供插件 ID、Logger、`DisposableCollection`、类型安全的 Hook/Event/Service API 和宿主运行时。创建资源后应立即通过 `context.disposables` 登记清理操作；启动失败回滚和插件停用时会执行清理。通过上下文进行的注册会在插件停用时自动移除。

插件使用 `context.events.on` 订阅、`context.events.emit` 发布类型化事件、通过 `context.services` 注册或获取服务，并用 `context.hooks.tap` 添加 Hook Handler。访问其他插件的服务必须声明兼容的依赖，且调用会受提供方和调用方生命周期保护。

## 宿主契约

`host.capabilities` 保存宿主提供的 API，`host.configuration` 保存宿主配置（提供 Schema 时会进行验证）。插件通过 `context.host` 访问顶层只读快照。

`RuntimeSchema<T>` 是最小验证契约：实现 `parse(input: unknown): T`，返回已验证值或抛出异常。`configurationSchema` 在应用构造时验证配置；每个 `eventSchemas` 项验证对应事件，之后 `emitExternal` 才会派发。缺少事件 Schema 或解析失败会抛出 `ContractValidationError`。

## 错误

- `ApplicationStartError`：启动失败，保留原始 `cause` 和 `rollbackErrors`。
- `PluginActivationError` / `PluginDeactivationError`：插件 ID 及激活清理或停用阶段错误。
- `PluginDependencyError`：插件依赖或 API 版本范围解析失败。
- `HookExecutionError`：Handler 失败对应的 Hook 和插件上下文。
- `EventDispatchError`：事件名及按监听器所属插件归类的失败。
- `ServiceNotFoundError`：不可用服务及调用方/提供方上下文。
- 注册错误（`PluginRegistrationError`、`HookRegistrationError`、`EventRegistrationError`、`ServiceRegistrationError`、`DuplicateRegistrationError`）：注册或使用无效/不可用。
- `ContractValidationError`：外部配置或事件输入无效。

## 版本与兼容性约定

包根导出和本文档定义公共 API。内部模块路径不提供兼容性保证。插件 `manifest.apiVersion` 使用 SemVer 范围，且必须包含宿主的 `apiVersion`；插件依赖范围会与已注册插件版本进行校验。

Corvix 在 1.0.0 之前允许次版本发布引入公共 API 破坏性变更；修订版本仅用于向后兼容的修复。包版本与 `apiVersion` 相互独立：包版本表示 Corvix 发布版本，`apiVersion` 表示插件所面向的运行时契约。未来发布 1.0.0 后，将采用 SemVer 对稳定主版本的兼容性承诺。
