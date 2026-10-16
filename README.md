# dsh-mermaid

一个 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) Web 插件，自动渲染对话中的 ` ```mermaid ` 代码块。

**完全离线** —— Mermaid 已打包进客户端产物。无 CDN、无网络请求。

> **目标运行时：DSH 0.2.0-rc.2。** 本版是按该版本的新插件机制重写的，1.x 的手工安装方式已作废，见下方「2.0 变更」。

## 特性

- 自动渲染对话中的每个 mermaid 代码块（含 shadow DOM 内部）
- 跟随应用浅色/深色模式的配色，应用内切换主题时自动重渲染（官方 `theme/change` 事件为主，DOM 属性 / token 亮度 / 系统偏好为兜底）
- 工具栏：源码/图表切换 · 放大 · 缩小 · 重置 · 缩放百分比 · 导出 SVG · 全屏
- 全屏优先使用浏览器原生 Fullscreen API，失败时降级为页面内覆盖层；两种模式都支持 ESC 退出，全屏内缩放平移照常可用
- 图形区域内自由拖拽平移，以中心为基准 25%–400% 缩放
- 串行化渲染队列（一页多个图表也安全）
- 健壮的文本提取：混入的行号痕迹会被剥离（渲染失败时才启用该回退，见下文）
- **渲染失败会自愈**：宿主在流式输出时，代码块是被逐字补齐的。插件在块还没写完时若不接受它，就在标记里记下当时的文本；文本一旦变化即摘掉标记重试，所以图会在输出完成后自己出现，不需要刷新页面。真正的坏文档（文本不变）仍然不会反复重试。
- **报错说的是 mermaid 的原话**：mermaid 会以字符串、Error 或带哈希的对象拒绝请求，插件把这三种形态都还原成同一条可读信息，日志不再把环境问题误报成「文档不合法」。

---

## 2.0 变更

1.x 是「手工把文件拷进 `~/.dsh/profiles/node_modules/`，再手改 `cordis.patch.yml`」。0.2.0-rc.2 的官方插件机制已经不允许这么做，本版随之重写。

### 打包与安装

| | 1.x | 2.0 |
|---|---|---|
| 形态 | 散装文件（`lib/`） | **bundle 包**：`package.json` 声明 `dsh.bundle.patch` |
| 注册 | 手写 profile 的 `cordis.patch.yml` | `cordis.patch.yml` 随包提供 |
| 安装 | 手工拷贝 + 手改配置 | `plugin_manager` 的 `install_bundle` |
| 产物位置 | `lib/index.js`、`lib/client.js` | 根目录 `index.js`、`client.js` |
| 插件管理页 | 无元数据 | `icon.svg` + `locale/{en,zh}.json` |

### 客户端产物

- 仍然是模块加载器形态（`window.__ModuleLoader__.load({ id, factory })`），`id` 必须等于包名——产物由 `build.mjs` 从 `package.json` 读取，不会写错。
- **不再使用裸 `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`。** 新版动态客户端沙箱把这四个名字（外加 `fetch`、`require`）替换成会抛错的向导桩；本版改用具名限定的 `window.setTimeout`，并以 `queueMicrotask` 兜底。devtest 里有对应的回归检查。
- 同时也不再注入 `timer` 服务：`cordis-plugin-timer` 没有客户端半部，声明 `inject: ['timer']` 只会让插件永远停在未激活状态。

### 渲染器

0.2.0-rc.2 的代码块渲染和 1.x 不一样了。实测（从 `dsh-web-frontend` 与 `dsh-client-ui-*` 产物解出）**对话里**的代码块长这样——banner 是 CodeCard 变体，语言名埋在两层的 `heading > span.language` 里：

```html
<div class="… md-code-block …">
  <div class="…bannerWrap…">
    <div class="…header…" data-code-block-banner="true">
      <div class="…heading…">
        <span class="…language…">代码块</span>   ← mermaid 不是语法高亮语言，宿主印的是通用文案
      </div>
      <div class="…action…"><button>复制</button></div>
    </div>
  </div>
  <div class="…content…" data-code-block-content="true">
    <pre class="…plain…"><code><span class="line">…</span></code></pre>
  </div>
</div>
```

宿主的代码块渲染器有**两个 banner 变体**：简版（`div.infostring` 就是原始 info string）和上面的 CodeCard header 版。**聊天里恒为后者**——`dsh-client-ui-chat` 的 `markdownLabels()` 总会传 `toolbarLabels`。CodeCard 语言 span 的内容是 `isKnownLang(lang) ? lang : codeLabel`，而 `codeLabel = t('codeBlock.title')`，实际文案是「代码块」/「Code block」：**mermaid 不在高亮语言表里，所以它在聊天里的标签是本地化的通用文案，而不是语言名。**

因此本版：

- **改用宿主自己的 `data-code-block-content` / `data-code-block-banner` 语义钩子定位**，不再依赖类名。0.2.0-rc.2 的代码块类名是 CSS Modules 哈希（`_block_7gxqk_4` 之类），逐版本变化，不能当契约。
- **banner 标签只在它「像裸语言标签」时才算权威**（`/^[A-Za-z][\w+#.-]*$/`）。`python` 这种真正的语言名会否决该块；而「代码块」/「Code block」这类宿主通用文案不含任何语言信息，必须放行给源码首行关键字兜底。读标签时会下钻到 `heading > span.language`，不会把用户自己写的 title 拼进来。**2.0.1 修的就是这条**：旧写法把任何非空标签都当否决，于是聊天里每个 mermaid 块都被静默跳过。
- **优先用 banner 里的语言名判断**。旧版依赖 `<code class="language-mermaid">`，而新版对非空代码块**根本不写 `language-*` 类**（那个类只出现在空围栏上）。拿不到可作数的标签时才退回读源码首行关键字。
- **深色检测补上了 `body[data-ds-dark-theme]`**。新版主题由 `body[data-ds-dark-theme]` + 同名 token 块切换，旧版只看了 `html.style.colorScheme` 和 token 亮度，会漏。
- **工具栏不再测量宿主的 banner 高度。** 旧版为了把工具栏贴在 sticky banner 正下方，会去读另一个插件的 DOM 尺寸——新版插件规范明确反对（"Do not read another plugin's DOM … to estimate placement"），而且 banner 高度会随宿主改版变化。本版把工具栏放回图形区的正常流顶部，零测量。代价：长图滚动时工具栏不再悬浮。
- **失败的块不再被永久判死**（2.0.1 的第二处修正）。原实现先跑 `mermaid.parse` 当闸门，不通过就打上永久 `failed` 标记；而宿主是**流式**渲染的，块在被写完之前必然先经历一次「半截文本」——于是每个 mermaid 块都有机会被自己的前半句判死，且之后再不重试。现在改为渲染优先，并且失败标记会连带记下当时的文本，文本一变即重试。

---

## 安装

`desktop` profile 由桌面端独占管理，CLI 碰不到它（`dsh --profile desktop --dump-config` 会直接报 `managed exclusively by the Electron application`）。要在桌面端内部装：

1. 切到 **cordis 预设**（官方文档称 Creator 模式）——`plugin_manager` 工具只在该预设下启用，其它 preset 默认关闭。
2. 说一句：

   > 把 `D:\Code\demo\dsh-mermaid` 装成当前 profile 的插件

   模型会调用 `plugin_manager`，`action: install_bundle`，`target` 为这个绝对路径。这一步会弹一次审批。
3. **新开一个会话**，刷新页面——mermaid 代码块即刻开始渲染。

也可以用侧边栏 **Plugins** 页面，从本地路径安装。

### ⚠️ 不要这么做

官方插件规范明文禁止：

> Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`, or run pnpm in the profile directory: `install_bundle` performs those steps.

手工拷贝文件、手改 profile 的 patch、在 profile 目录里跑 pnpm —— 全部不要。

### CLI（仅限非 desktop profile）

```powershell
dsh plugin --profile web add "D:\Code\demo\dsh-mermaid"
```

---

## 验证

装完之后**不用翻日志**：

1. `install_bundle` 的返回里 `application: applied` 才算真的生效。
2. 用内置的 `cordis_inspect_list` / `cordis_inspect_query`（`host` / `Tool`、或 client 的 `Slots`）确认插件已挂载。这两个工具不需要审批。
3. 让对话里出现一个 ` ```mermaid ` 代码块，看它是否被替换成图表。

---

## 卸载

侧边栏 Plugins 页面移除，或在会话里让模型 `remove_bundle`。插件卸载时会还原它替换过的所有代码块、摘掉自己的样式表、断开观察器，不留残余。

---

## 从源码构建

```bash
# 1. 把 mermaid 的浏览器构建产物放到 vendor/mermaid.min.js
#    （取自 mermaid npm 包的 dist/mermaid.min.js）
# 2. 构建客户端产物
node build.mjs
# → 重新生成 client.js（模块工厂包装 + 内联 mermaid + 渲染器）
```

`build.mjs` 会校验：`@test-only` 区块被剥离、`exports.apply` 存在、产物能被 `new Function` 编译通过。任何一项不过就直接失败，不会产出坏包。

渲染器源码在 `src/client.js`；构建脚本把它与打包好的 mermaid IIFE 拼进同一个模块工厂。

## 测试

```bash
node devtest/run.mjs        # 纯函数 / 清单 / 产物 / 沙箱规则
node devtest/dom-check.mjs  # 代码块判定（Bug A 的守护）
```

两个都不需要浏览器、不需要 DSH 安装。

`run.mjs` 四组检查：

- **manifest**：bundle patch 存在且指向包名、`dsh.client.platform`、`exports` 与 `files` 覆盖全部运行期产物、不依赖任何 `@deepseek-ai/*` 包（零 peer 就没有安装版本校验）
- **构建产物**：模块工厂 id 等于包名、`@test-only` 已剥离、产物可编译
- **沙箱规则**：源码里不出现裸 timer 全局 / `fetch` / `require`
- **渲染逻辑**：源码识别（含 `graphql` 不被误判成 `graph`）、banner 语言名、行号清洗（含 async `resolveSource`）、深色判定与亮度解析

`dom-check.mjs` 用**从 `src/client.js` 加载的真实判定函数**（不是手抄副本）跑一组假 DOM，覆盖宿主的两个 banner 变体：

- 真实聊天结构 + 通用标签「代码块」/「Code block」→ 必须渲染（旧写法在这里恒不渲染，文件顶部留了对照用例）
- `python` / `javascript` / `text` 这类真正的语言名 → 必须否决，不能因为放行通用标签就一起放行
- 带 `title` 的块 → 标签只取 `span.language`，不把 title 拼进来
- 已标记 / 已在我们自己的容器里 → 跳过

## 升级 mermaid

把 `vendor/mermaid.min.js` 换成目标版本的 `dist/mermaid.min.js`，`node build.mjs`，然后重新安装 bundle（本地路径包替换后需要重启进程才能加载新的 JavaScript 模块代）。

---

## 工作原理

- `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，patch 里插入一行 `dsh-mermaid`；该行让 Host Loader 有一个条目可扫描。
- `dsh.client.platform: "web"` 加上 `exports["./client"]` 让 `dsh-client-modules` 找到浏览器产物，并挂在 `/plugins/` 路由下提供。**该路由的 URL 带构建修订号**（`/plugins/dsh-mermaid/client.js?rev=<hash>`），修订号由产物的 mtime / ctime / size 推导——手拼一个不带 `rev` 的 URL 只会得到 404，这是正常的，不代表产物缺失。
- 产物是一个 `__ModuleLoader__` 工厂：mermaid IIFE 在 factory 作用域内执行并暴露 `globalThis.mermaid`，随后渲染器（`exports.apply`）监听 DOM，渲染每个 mermaid 代码块并装配工具栏 / 缩放 / 平移 / 导出 / 全屏。
- **判定一个块要不要渲染，靠的是渲染本身**：直接 `mermaid.render` 原文，只有失败时才回头去试行号清洗后的候选。刻意不先用 `mermaid.parse` 做前置闸门——解析谓词比渲染更严，一旦它说不，日志就会把责任推给文档，而真正的原因（流式半截文本、环境差异）全被吞掉。
- 渲染时只替换宿主内容节点里的 `<pre>`，**不动代码块的 banner 与外框**，所以宿主的布局不依赖被替换的节点。

## 已知限制

- **没有代码围栏插槽可用。** 新版 UI 的 `conversation.*` 插槽只有 `composer`、`composer.bar`、`composer.dock`，没有「渲染某个围栏」这种扩展点。所以 mermaid 渲染只能是对已渲染节点的后处理——这不是偷懒，是宿主目前没有别的口子。
- **会替换一个由 React 渲染的节点。** 这是这类插件固有的风险：宿主在流式输出时重渲染该行，理论上可能与其 DOM 记录冲突。本版把替换范围收窄到内容节点内、只读宿主的语义属性、并在每一步 `try/catch` + 连接性检查，但不能从原理上消除。若出现渲染异常，先把对应代码块切换成源码视图，或临时在 Plugins 页停用本插件。
- **流式块会先失败、后自愈。** 一个还在输出的块必然先被当成坏文档拒绝一次，控制台会留一条 `render failed — mermaid said: …`。这是预期行为：等文本不再变化，下一次防抖扫描（DOM 静默 250 ms）就会重新尝试并成图。**只有文本不再变化的块才会一直失败**——那种情况下的报错才是真话，可以直接照着 mermaid 的原话改图。
- **状态标记写在宿主节点上。** `data-dsh-mermaid` 与 `data-dsh-mermaid-failed-text` 挂在宿主的 `<pre>` 上，插件被停用时（`ctx.effect` 的 teardown）会连同标记一起还原，不留残余。
- **工具栏不再悬浮。** 见「2.0 变更」——为了不读宿主的 DOM 尺寸。
- **`` ```text `` 里正好以 mermaid 关键字开头的块会被误渲染。** 这是「通用标签不作数」的代价：宿主的通用标签分不清「用户明确写了 `text`」和「用户写了 `mermaid` 但标签读不到语言」。真要表达一段以 `graph TD` 开头的非 mermaid 文本，用一个真正的语言标签（如 ```` ```python ````）就会否决。
- **产物约 3.4 MiB。** Mermaid 全量内联，换取完全离线与零网络请求。这是用体积换确定性。

## 许可证

MIT。Mermaid 按其自身的 MIT 许可证打包 —— 见 `vendor/LICENSE-mermaid`。
