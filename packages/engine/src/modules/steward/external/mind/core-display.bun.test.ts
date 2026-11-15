import { expect, test } from 'bun:test';
import { taskTitle } from './core-display';

for (const [goal, title] of [
  ['整理研究资料', '整理研究资料'],
  [`改进 应用中心：改善应用列表的布局与操作\n反馈对应版本：${'a'.repeat(40)}；应用：a72dc177-cd15-47fa-9335-18e2ec58e4c2；页面：/p/apps/available`, '改进 应用中心：改善应用列表的布局与操作'],
  ['改善页面布局\n反馈页面：/p/apps/available', '改善页面布局'],
  ['改善页面布局\r\n补充要求：保留搜索', '改善页面布局'],
  [`应用列表改版 · ${'b'.repeat(64)}`, '应用列表改版'],
  ['应用列表改版 · a72dc177-cd15-47fa-9335-18e2ec58e4c2', '应用列表改版'],
  ['a72dc177-cd15-47fa-9335-18e2ec58e4c2', '应用改进'],
  ['改善页面布局 反馈对应版本：旧版本', '改善页面布局'],
  ['保留 SHA-256 文件校验', '保留 SHA-256 文件校验'],
  ['', '应用改进'],
]) {
  test(`taskTitle derives a display title from ${JSON.stringify(goal)}`, () => {
    expect(taskTitle(goal!)).toBe(title!);
  });
}
