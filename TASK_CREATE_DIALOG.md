# Task Create Dialog - Google Calendar Style

## 改进内容

### 之前的实现
- 使用内联表单 (`ScheduleInlineQuickCreate`)
- 表单直接嵌入在时间轴中
- 位置固定在时间轴内部
- 样式较为简单

### 新的实现
创建了全新的 `TaskCreateDialog` 组件，完全模仿Google Calendar的弹窗样式：

**视觉设计**：
- 居中的模态对话框
- 半透明背景遮罩 (`backdrop-blur-sm`)
- 清晰的三段式布局：Header / Content / Footer
- 圆角边框 (`rounded-2xl`)
- 阴影效果 (`shadow-2xl`)

**功能特性**：
1. **标题输入** - 大号无边框输入框，只有底部边框
2. **日期选择** - 原生日期选择器
3. **时间范围** - 分开的开始时间和结束时间选择器
4. **描述字段** - 可选的多行文本框
5. **优先级选择** - 四个按钮：Low / Medium / High / Urgent
6. **键盘支持** - ESC关闭对话框
7. **自动聚焦** - 打开时自动聚焦标题输入框

**交互改进**：
- 点击背景遮罩关闭对话框
- 右上角X按钮关闭
- Cancel按钮取消
- Save按钮提交（标题为空时禁用）
- 保存中显示"Saving..."状态

## 文件变更

### 新增文件
- `src/components/schedule/task-create-dialog.tsx` - 新的对话框组件

### 修改文件
- `src/components/schedule/schedule-page-timeline.tsx`
  - 导入新的 `TaskCreateDialog` 替代 `ScheduleInlineQuickCreate`
  - 简化 `TimelineComposer` 组件，直接使用对话框
  - 移除了复杂的定位计算逻辑

## 使用方式

```tsx
<TaskCreateDialog
  isOpen={true}
  initialStartAt={startDate}
  initialEndAt={endDate}
  isPending={false}
  onClose={() => setOpen(false)}
  onSubmit={async (input) => {
    // 处理提交
  }}
/>
```

## 优势

1. **更好的用户体验** - 对话框居中显示，不受时间轴滚动影响
2. **更清晰的视觉层次** - 背景遮罩突出对话框
3. **更多的输入空间** - 不受时间轴宽度限制
4. **更符合用户习惯** - 与Google Calendar等主流应用一致
5. **更易维护** - 独立组件，职责单一

## 后续可优化

1. 添加日期快捷选择（今天、明天、下周等）
2. 添加重复任务选项
3. 添加提醒设置
4. 支持拖拽调整时间
5. 添加任务模板
