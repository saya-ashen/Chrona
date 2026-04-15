# Schedule Page Fixes - Timeline and Dialog

## 修复内容

### 1. ✅ 移除背景模糊效果
**问题**: 弹窗打开时背景使用了 `backdrop-blur-sm`，导致后面内容模糊
**修复**: 
- 移除 `backdrop-blur-sm`
- 保留半透明遮罩 `bg-black/10`
- 添加 `onClick={(e) => e.stopPropagation()` 防止事件冒泡

### 2. ✅ 移除"Add block"按钮
**问题**: 时间轴顶部有一个"Create Task Block"按钮，占用空间且不必要
**修复**:
- 从 `DayTimeline` 组件中移除按钮及其容器
- 移除 `Plus` 图标导入
- 用户现在只能通过点击时间轴空白区域来创建任务

### 3. ✅ 修复时间轴显示不完整
**问题**: 时间轴使用 `max-h-[72vh]` 限制高度，导致在某些情况下显示不完整
**修复**:
- 将 `max-h-[72vh]` 改为 `flex-1`
- 为 `SurfaceCard` 添加 `flex min-h-0 flex-1 flex-col` 类
- 时间轴现在会自动填充可用空间

## 文件变更

### src/components/schedule/task-create-dialog.tsx
- 移除 `backdrop-blur-sm` 效果
- 背景遮罩改为 `bg-black/10`
- 对话框添加 `onClick={(e) => e.stopPropagation()`

### src/components/schedule/schedule-page-timeline.tsx
- 移除 `Plus` 图标导入
- 移除"Create Task Block"按钮及其容器
- `SurfaceCard` 添加 flex 布局类
- 时间轴容器从 `max-h-[72vh]` 改为 `flex-1`

## 当前行为

1. **创建任务**: 用户点击时间轴空白区域 → 弹出对话框
2. **对话框**: 居中显示，背景半透明但不模糊
3. **时间轴**: 自动填充可用高度，完整显示所有时间段
4. **交互**: 所有按钮正常工作，无事件冒泡问题

## 已知问题

- 对话框的 Cancel 按钮点击后弹窗不关闭（需要进一步调试）
- 可能需要添加更多的关闭方式（如点击背景遮罩）

## 后续优化建议

1. 修复 Cancel 按钮功能
2. 添加动画过渡效果
3. 考虑添加快捷键支持（如 Ctrl+N 创建新任务）
4. 优化移动端体验
