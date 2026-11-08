# Web 外壳与应用组合组件

2026-11-08：全站统一外壳与应用私有声明式组件已完成开发集成。以下描述源码能力；随后已更新运行在 3111 端口的本机试用部署，见文末。页面继续使用共享 json-render，不引入应用脚本加载器。

## 职责

Web 拥有登录、导航、路由、主题、字体、控件实现、响应式布局、无障碍和页面校验。今天、对话、应用、活动、设置，以及应用登记的页面共用外壳。内置页的系统操作仍通过 `mountSystem` 的受限适配器处理；普通登记页只能调用登记应用自己的工具。

应用决定业务内容、信息结构、组件组合、状态含义和业务操作。例如 coding 管理项目与会话、回复、问题选项和结果；它登记 `coding:QuestionCard` 与 `coding:ConversationComposer`，以公共组件组合自己的呈现，并提供工具回调。

页面可以声明 `layout: "document" | "workspace"`，默认 document。document 内容居中，workspace 使用可用的视口区域。Web 根据页面声明设置外壳状态，在导航、错误、登录和退出时更新或清理。页面中的某个子组件不再改变整站导航和主题。

## 随页面登记组合定义

在已有 `web.page-set` 参数中传入 `components`。定义按当前应用命名空间命名，跟随该页面版本生效；同一应用可从自己的源文件复用定义。当前没有单独的全局组件注册表，也不支持跨应用引用定义。

```json
{
  "id": "main",
  "title": "笔记",
  "layout": "document",
  "components": {
    "notes:NoteCard": {
      "props": {
        "type": "object",
        "properties": { "title": { "type": "string" } },
        "required": ["title"],
        "additionalProperties": false
      },
      "events": ["open"],
      "slots": ["default"],
      "spec": {
        "root": "card",
        "elements": {
          "card": { "type": "Panel", "props": {}, "children": ["heading", "$slot:default", "open"] },
          "heading": { "type": "Heading", "props": { "text": { "$prop": "title" } }, "children": [] },
          "open": { "type": "Button", "props": { "label": "打开" }, "on": { "press": { "$event": "open" } }, "children": [] }
        }
      }
    }
  },
  "spec": {
    "root": "note",
    "elements": {
      "note": {
        "type": "notes:NoteCard",
        "props": { "title": "今天的笔记" },
        "children": ["body"],
        "on": { "open": { "action": "call", "params": { "tool": "open-note", "args": { "id": "today" } } } }
      },
      "body": { "type": "Text", "props": { "text": "笔记摘要" }, "children": [] }
    }
  }
}
```

上例假定登记应用名为 notes，并且它已经公开 `open-note` 工具和对应输入契约。Web 在登记时展开定义，再校验公共组件、属性、事件、数据源与本应用工具。只有通过校验的展开结果会存储，浏览器不执行模板解释器或应用代码。

- `{$prop:"name"}` 转发声明的属性，包括 `$state`、`$bindState`、`$item` 等表达式。字面值按属性 JSON Schema 检查；动态值仍按公共组件规则处理。
- `{$event:"name"}` 转发使用方提供的事件绑定。业务工具调用仍接受原有应用身份、工具契约指纹与页面 revision 校验。
- 子节点引用 `$slot:default` 接入 children，`$slot:actions` 等接入具名 slots。每次实例展开生成独立内部节点名；嵌套组件、列表 item 作用域、可见条件和绑定保持有效。
- 模板不能声明私有 state、脚本、任意 HTML/CSS 或新增系统能力。需要交互状态时由页面显式提供绑定。
- 每页至多 16 个定义、每定义 100 个节点、嵌套 8 层、展开后 300 个节点。原始与展开页面分别限制为 64 KiB；展开过程中在复制前累计限制 4096 个子节点引用，并累计检查节点字节量，避免插槽转发产生指数级分配。递归、节点循环、未知属性/事件/插槽与失效工具契约会拒绝登记或要求重新登记。

增加浏览器原生能力（例如编辑器、终端）仍需要 Web 的明确实现和契约。组合定义只复用现有公共能力。

## 通用交互契约

`Composer.on.submit` 是明确的提交事件。Enter 在非输入法组合、非 Shift 且未禁用时触发它；点击发送按钮由页面绑定相同操作。`Composer.disabled` 控制键盘提交，按钮是否禁用也由页面明确绑定。键盘行为不再寻找某个样式类的按钮。

`WorkspaceHeader.statusTone` 可为 neutral、success、warning、danger，默认 neutral。业务应用提供含义；coding 将确认完成显示为 success、失败显示为 danger、未知或等待停止显示为 warning。状态文本本身不被 Web 猜测为成功。

## 验证与证据

使用临时数据库、受控 HTTP 返回与 fake Agent；未调用真实模型、操作真实项目或修改部署数据。

- 组合、页面生命周期、catalog、通用组件与 Coding 工作台：80 项 Bun 测试、659 个断言通过。包括属性/插槽/事件、嵌套重复、绑定、注册持久化、工具契约失效，以及审查发现的插槽放大回归。
- 实际 coding/editor 安装、作者测试和 Web 图片边界：另 9 项测试、31 个断言通过（合计 89 项、690 个断言）。
- 全站浏览器：1440×900、1024×768、390×844 共 47 组场景通过。涵盖内置页、注册文档/工作区页、亮暗主题、active 导航、浏览器历史、过期凭证、退出重登与延迟响应；使用与部署相同的 CSP。
- 实际 Coding 页面与业务 handler：三种宽度通过目录选择、原生问题、草稿轮询、Enter/Shift+Enter、续接轮次、成果页停止和刷新恢复。审查另外核对三种输入模式的 Enter 与按钮请求一致。
- 通用浏览器组件另检查输入法组合、焦点/光标、阅读位置和自动跟随。TypeScript、变更文件 ESLint、`git diff --check` 通过。

截图采用受控数据： [桌面今天](../validation/web-components/today-desktop.png)、[手机设置](../validation/web-components/settings-mobile.png)、[应用组合页](../validation/web-components/document-desktop.png)、[Coding 桌面](../validation/web-components/coding-desktop.png)、[Coding 手机](../validation/web-components/coding-mobile.png)。截图证明呈现与布局，不代表真实模型执行。

关键源码：`builtin/web/composition.ts`、`pages.ts`、`catalog.ts`、`app.js`、`shell.css`、`src/workspace.tsx`，以及 `external/coding/components.ts`、`page.ts`。Web 的 `build.ts` 将共享组件样式与全站样式写入同源 `style.css`，不放宽 CSP。

源码提交：`094768c1`（登记展开）、`f2216d8f`（全站外壳、应用组合消费及资源边界修复）。

## 本机试用部署更新

2026-11-08 已更新实际 `chrona-v1-preview.service`（3111）。源码 `5b21907c`，受检激活 Web `f0d0cc93a1d7d4e73e1849b205a2c1d9b169ed36`、Coding `1353d948ccbef466b5dcc465c5303a2d4181cbfb`。首次更新因 Coding 的 layout 被推断成 string、未满足新 Web 枚举契约而拒绝，脚本完整回滚；修正为字面量，并让安装回归使用实际 Web 契约后重新构建和更新通过。

更新前备份：`/home/saya/.local/share/chrona-v1-preview/backups/before-whole-web-20261108T065822Z`。数据库结构无变化；原 8 个 Session、4 个 Message、8 个 Run、0 个 ExecutionAttempt 及模块状态保留，完整性和外键检查通过。健康和就绪正常。实际认证浏览器在三种尺寸检查六条页面路线，共 18 次页面检查，并确认 Coding 登记为 workspace、私有组件已在服务端展开。未调用模型或编辑项目。实例详情与验证引用记录在部署目录的 `deployment.json` 和 README 中。
