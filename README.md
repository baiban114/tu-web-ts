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
VITE_DEV_PROXY_TARGET=http://localhost:8080
```

- `VITE_DEFAULT_DATA_SOURCE` 可选 `backend` 或 `mock`
- `VITE_DEV_PROXY_TARGET` 控制开发代理后端地址
