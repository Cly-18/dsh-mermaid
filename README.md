# dsh-mermaid

一个 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) Web 插件,自动渲染对话中的 ```mermaid 代码块。

**完全离线** —— Mermaid 11 已打包进客户端 bundle。无 CDN、无网络、运行时零下载。

## 特性

- 自动渲染对话中的每个 ` ```mermaid ` 代码块(包括 shadow DOM 内部)
- 跟随应用浅色/深色模式的彩色主题
- 图表居中显示在带最小高度的图形区域中
- 工具栏(右上角,内联 SVG 图标按钮,带悬停提示):源码/图表切换 · 放大 · 缩小 · 重置 · 缩放百分比 · 导出SVG
- 图形区域内自由拖拽平移,以中心为基准 25%–400% 缩放
- 串行化渲染队列(一页多个图表也安全)
- 健壮的文本提取:渲染前用 `mermaid.parse` 校验代码文本,并剥离混入的行号痕迹;插件重启后会重试失败的代码块(激活时重置陈旧的渲染标记)

## 安装

插件是一个双面包:一个空操作的 node 半部 + 一个 `dsh.client` 浏览器半部。

1. **放置包文件**到你的 profile 解析包的目录:

   ```bash
   # 假设你的 profile 名为 "web",DSH 主目录为 ~/.dsh
   mkdir -p ~/.dsh/profiles/node_modules/dsh-mermaid
   cp package.json lib/index.js lib/client.js ~/.dsh/profiles/node_modules/dsh-mermaid/
   ```

   (如果发布到了 npm,也可以用 `npm install dsh-mermaid` / `npm link`)

2. **在 profile 补丁中注册插件行**,例如 `~/.dsh/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-mermaid
         name: 'dsh-mermaid'
   ```

3. **重启 DSH**,刷新页面 —— mermaid 代码块即刻开始渲染,刷新页面与离线使用均不受影响。

## 从源码构建

```bash
# 1. 把 mermaid 的浏览器构建产物放到 vendor/mermaid.min.js
#    (取自 mermaid npm 包的 dist/mermaid.min.js)
# 2. 构建客户端 bundle
node build.mjs
# → 重新生成 lib/client.js(factory 包装 + 内联 mermaid + 渲染器)
```

渲染器源码位于 `src/client.js`;构建脚本把它与打包好的 mermaid IIFE 拼接到模块 factory 里。

## 升级 mermaid

把 `vendor/mermaid.min.js` 替换为你想要版本的 `dist/mermaid.min.js`,运行 `node build.mjs`,再把 `lib/client.js` 复制回你的 profile。

## 工作原理

- `package.json` 声明了 `dsh.client.platform: "web"` 并导出 `./client`;
  DSH 的 client-modules 主机半部扫描 Loader 条目,通过
  `/plugins/dsh-mermaid/client.js` 提供服务,并将其注入 `window.__DSH_BOOT__`。
- bundle 是一个 `__ModuleLoader__` factory:mermaid IIFE 在 factory 作用域内执行并暴露 `globalThis.mermaid`,随后渲染器插件(`exports.apply`)监听 DOM,渲染每个 mermaid 代码块,并装配工具栏/缩放/平移/导出 UI。

## 许可证

MIT。Mermaid 按其自身的 MIT 许可证打包 —— 见 `vendor/LICENSE-mermaid`。
