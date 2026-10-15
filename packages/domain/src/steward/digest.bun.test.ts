import { expect, test } from "bun:test";
import { composeDigest } from "./digest";
test.each([0, 1, 10, 11, 15])("digest count %s", (count) => {
  const result = composeDigest(Array.from({ length: count }, (_, i) => ({ affairTitle: i % 2 ? "读书" : null, title: `变化${i}`, body: "请查看事务" })), { dayLabel: "今天" });
  if (!count) { expect(result).toBeNull(); return; }
  expect(result?.title).toBe("今天日报");
  expect(result?.body.match(/^- /gm)?.length).toBe(Math.min(count, 10));
  expect(result?.body.includes(`另有 ${count - 10} 条`)).toBe(count > 10);
});
test.each(["读书", null])("groups %s", (affairTitle) => {
  expect(composeDigest([{ affairTitle, title: "甲", body: "一" }, { affairTitle, title: "乙", body: "二" }], { dayLabel: "今天" })?.body).toBe(`${affairTitle ?? "其他动态"}\n- 甲：一\n- 乙：二`);
});
