# tu-web-ts

当前前端支持两套开发数据源：

- `backend`：默认模式，请求 `/api/*` 并通过 Vite 代理转发到后端。
- `mock`：本地浏览器存储中的 mock 数据，无需后端即可完成页面树、内容编辑、引用块和块同步调试。

## 开发者模式

运行 `npm run dev` 后，页面右下角会出现 `Developer Mode` 面板，仅在开发环境显示。

- 可以随时切换 `Backend / Mock`
- 可以点击 `Reset Mock` 重置本地 mock 数据
- 当前选择会写入浏览器 `localStorage`

## 环境变量

可参考 [.env.development.example](/D:/project/tu/tu-web-ts/.env.development.example)：

```bash
VITE_DEFAULT_DATA_SOURCE=backend
VITE_DEV_PROXY_TARGET=http://localhost:18080
```

- `VITE_DEFAULT_DATA_SOURCE` 可选 `backend` 或 `mock`
- `VITE_DEV_PROXY_TARGET` 控制开发代理后端地址

## E2E 测试

前端使用 Playwright 做端到端测试，测试脚本保存在 `e2e/`，配置文件为 `playwright.config.ts`。

```bash
npm run test:e2e
npm run test:e2e:ui
```

Playwright 会自动启动 Vite，并设置 `VITE_DEFAULT_DATA_SOURCE=mock`，因此默认不依赖后端服务。

如果 Playwright 浏览器下载在国内网络下不可用，可以直接使用本机已安装的 Chrome/Chrome Canary：

```powershell
$env:PLAYWRIGHT_BROWSER_CHANNEL='chrome-canary'
npm run test:e2e
```

新增或修改用户可见功能时，应同步更新功能描述，并为编辑器、nodeView、目录、悬浮工具栏等交互行为补充或更新 E2E 用例。

## 表格列操作

普通表格和多维表格共用前端列操作抽象。普通表格列头右键可在左侧或右侧新增列，也可删除列；新增列会同步表头、每行单元格和列宽。多维表格字段列头右键可打开字段设置、重命名字段、在左侧或右侧新增列以及删除字段；新增列等价于新增 `text` 字段，并会为现有记录补默认值。

多维表格默认以空白表格创建；工具栏中的 `任务看板` 会应用任务管理预设，创建任务、状态、负责人、截止日期和预估工时字段，并切换到按状态分组的看板视图。

多维表格的表格视图底部提供 `+ 新增一行` 操作，新增记录时会按当前字段类型填充默认值。任务看板支持为单条任务添加子任务，子任务可独立填写工时；看板和工具栏会汇总任务与子任务的预估工时。
