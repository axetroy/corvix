# Corvix

Corvix 是面向 TypeScript 应用的平台无关、类型安全插件运行时，提供显式插件注册、依赖管理和生命周期资源清理能力。

当前实现聚焦于第一阶段的应用与插件生命周期基础。Hook、Event 和 Service 将按照 [`design.md`](./design.md) 中的阶段逐步实现。

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

启动失败后可再次调用 `app.start()` 重试全部插件。`app.retryPlugin(id)` 会重试指定失败插件及其依赖，再继续应用启动；只有全部插件激活成功后，应用才进入运行状态。

完整架构与生命周期约定参见 [`design.md`](./design.md)。

## 参与贡献

参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。
