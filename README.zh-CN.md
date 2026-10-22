# Corvix

Corvix 是面向 TypeScript 应用的平台无关、类型安全插件运行时，提供显式插件注册、依赖管理、生命周期资源清理以及 Hook、Event 和 Service。

当前实现包括应用与插件生命周期基础，以及类型安全的 Hook、Event 和 Service，详情参见 [`design.md`](./design.md)。

## 环境要求

- Node.js 18 或更高版本

## 安装与验证

```sh
npm ci
npm run check
```

`npm run check` 会执行代码检查、生产与测试类型检查、带覆盖率的测试、TypeScript 构建及 npm 包内容检查。

## 快速开始

```ts
import { CorvixApplication } from 'corvix';

const app = new CorvixApplication({ apiVersion: '0.1.0' });

app.register({
  manifest: {
    id: 'example.greeting',
    version: '1.0.0',
    apiVersion: '^0.1.0',
  },
  setup(context) {
    const timer = setInterval(() => console.log('Hello from Corvix'), 1000);
    context.disposables.add(() => clearInterval(timer));
  },
});

await app.start();
// 宿主关闭时：
await app.stop();
```

插件应立即通过 `context.disposables` 登记创建的资源，以便启动回滚和应用关闭时释放。插件版本及 API 兼容范围遵循 SemVer 2.0；必需依赖先于依赖方激活，兼容的可选依赖也会排在依赖方之前。

在 TypeScript 中声明事件、Hook 和 Service 契约，并在创建应用时提供 Hook 执行模式和结果策略。插件通过上下文注册自己拥有的 Hook、事件监听器和服务；插件停用时这些资源会被释放。Hook 支持同步、异步串行和异步并行执行，以及适用的 series、waterfall 和 bail 策略。事件同步派发，监听器失败会汇总报告但不会阻止其他监听器。调用其他插件的服务前，必须在 Manifest 中声明对提供方的依赖。

例如，可为应用声明契约映射及 Hook 运行时配置：

```ts
interface AppEvents {
  'file:saved': { path: string; hash: string };
}

interface AppHooks {
  'workspace:beforeOpen': {
    args: { workspaceId: string };
    result: { reason: string };
    mode: 'AsyncSeries';
    strategy: 'bail';
  };
}

interface AppServices {
  file: { read(path: string): Promise<string> };
}

const app = new CorvixApplication<AppEvents, AppHooks, AppServices>({
  apiVersion: '0.1.0',
  hooks: {
    'workspace:beforeOpen': { mode: 'AsyncSeries', strategy: 'bail' },
  },
});
```

在 `setup(context)` 中使用 `context.hooks.tap(...)`、`context.events.on(...)` / `emit(...)` 和 `context.services.register(...)` / `get(...)` / `tryGet(...)`。宿主可通过 `app.hooks.run(...)` 调用 Hook，并通过 `app.events.emit(...)` 发布事件；这两个入口仅在应用运行时可用。Waterfall Hook 的 `run` 需要初始值；Bail handler 返回 `{ type: 'continue' }` 或 `{ type: 'bail', value }`。

启动失败后可再次调用 `app.start()` 重试全部插件。`app.retryPlugin(id)` 会重试指定失败插件及其依赖，再继续应用启动；只有全部插件激活成功后，应用才进入运行状态。

完整架构与生命周期约定参见 [`design.md`](./design.md)。

## 参与贡献

参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。
