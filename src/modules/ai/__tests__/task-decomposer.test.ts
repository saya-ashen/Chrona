import { describe, expect, test } from "vitest";
import { decomposeTask } from "../task-decomposer";
import type { TaskDecompositionInput } from "../types";

/**
 * Helper to create a full TaskDecompositionInput with defaults
 */
function makeInput(overrides: Partial<TaskDecompositionInput> = {}): TaskDecompositionInput {
  return {
    taskId: "task-default",
    title: "Default Task",
    description: undefined,
    priority: "Medium",
    dueAt: null,
    estimatedMinutes: undefined,
    ...overrides,
  };
}

describe("task-decomposer", () => {
  // ─── Title-based decomposition ──────────────────────

  describe("title-based decomposition (conjunctions)", () => {
    test("splits title by 'and' conjunction", () => {
      const input = makeInput({
        title: "Write documentation and create tests",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Write documentation");
      expect(result.subtasks[1].title).toBe("Create tests");
    });

    test("splits title by 'and then'", () => {
      const input = makeInput({
        title: "Build the service and then deploy to production",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Build the service");
      expect(result.subtasks[1].title).toBe("Deploy to production");
    });

    test("splits title by 'then'", () => {
      const input = makeInput({
        title: "Compile the code then run the tests",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Compile the code");
      expect(result.subtasks[1].title).toBe("Run the tests");
    });

    test("splits title by 'followed by'", () => {
      const input = makeInput({
        title: "Design the UI followed by implementation",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Design the UI");
      expect(result.subtasks[1].title).toBe("Implementation");
    });

    test("assigns sequential order to subtasks", () => {
      const input = makeInput({
        title: "Prepare data and generate report",
      });
      const result = decomposeTask(input);

      expect(result.subtasks[0].order).toBe(1);
      expect(result.subtasks[1].order).toBe(2);
    });
  });

  // ─── Chinese text decomposition ─────────────────────

  describe("Chinese text decomposition", () => {
    test("splits title by '和' (and)", () => {
      const input = makeInput({
        title: "编写文档和创建测试",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("编写文档");
      expect(result.subtasks[1].title).toBe("创建测试");
    });

    test("splits title by '然后' (then)", () => {
      const input = makeInput({
        title: "设计界面然后实现功能",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("设计界面");
      expect(result.subtasks[1].title).toBe("实现功能");
    });

    test("splits title by '以及' (as well as)", () => {
      const input = makeInput({
        title: "更新数据库以及修复API",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("更新数据库");
      expect(result.subtasks[1].title).toBe("修复API");
    });

    test("splits title by '并且' (and also)", () => {
      const input = makeInput({
        title: "运行测试并且部署服务",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("运行测试");
      expect(result.subtasks[1].title).toBe("部署服务");
    });

    test("detects sequential dependency with '然后'", () => {
      const input = makeInput({
        title: "编译代码然后运行测试",
      });
      const result = decomposeTask(input);

      // '然后' implies sequential dependency
      expect(result.subtasks[0].dependsOnPrevious).toBe(false);
      expect(result.subtasks[1].dependsOnPrevious).toBe(true);
    });
  });

  // ─── Description-based decomposition ────────────────

  describe("description-based decomposition", () => {
    test("splits by numbered list in description", () => {
      const input = makeInput({
        title: "Setup project",
        description: `Steps:
1. Initialize repository
2. Configure CI/CD
3. Setup deployment pipeline`,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Initialize repository");
      expect(result.subtasks[1].title).toBe("Configure CI/CD");
      expect(result.subtasks[2].title).toBe("Setup deployment pipeline");
    });

    test("splits by bullet points in description", () => {
      const input = makeInput({
        title: "Fix bugs",
        description: `- Fix login page crash
- Fix search results pagination
- Fix mobile responsive layout`,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Fix login page crash");
      expect(result.subtasks[1].title).toBe("Fix search results pagination");
      expect(result.subtasks[2].title).toBe("Fix mobile responsive layout");
    });

    test("splits by asterisk bullet points", () => {
      const input = makeInput({
        title: "Update dependencies",
        description: `* Update React to v19
* Update Next.js to v15
* Update TypeScript to v5.5`,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Update React to v19");
    });

    test("splits by checkbox items", () => {
      const input = makeInput({
        title: "Release checklist",
        description: `[ ] Run test suite
[ ] Update changelog
[x] Bump version`,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Run test suite");
      expect(result.subtasks[1].title).toBe("Update changelog");
      expect(result.subtasks[2].title).toBe("Bump version");
    });

    test("description items take priority over conjunction splitting", () => {
      const input = makeInput({
        title: "Design and implement features",
        description: `1. Design the user flow
2. Implement the backend
3. Write integration tests`,
      });
      const result = decomposeTask(input);

      // Description strategy is tried before conjunction strategy
      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Design the user flow");
    });

    test("parenthesized numbered items (e.g. '1)') are recognized", () => {
      const input = makeInput({
        title: "Prepare release",
        description: `1) Tag the release
2) Build artifacts
3) Publish to NPM`,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Tag the release");
    });
  });

  // ─── Verb pattern decomposition ─────────────────────

  describe("verb pattern decomposition", () => {
    test("'review and update' splits into two subtasks", () => {
      const input = makeInput({
        title: "Review and update the API documentation",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Review the API documentation");
      expect(result.subtasks[1].title).toBe("Update the API documentation");
    });

    test("'research, design, implement' splits into three subtasks", () => {
      const input = makeInput({
        title: "Research, design, and implement user authentication",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Research user authentication");
      expect(result.subtasks[1].title).toBe("Design user authentication");
      expect(result.subtasks[2].title).toBe("Implement user authentication");
    });

    test("'design and implement' splits correctly", () => {
      const input = makeInput({
        title: "Design and implement the payment system",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Design the payment system");
      expect(result.subtasks[1].title).toBe("Implement the payment system");
    });

    test("'test and deploy' splits correctly", () => {
      const input = makeInput({
        title: "Test and deploy the new microservice",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Test the new microservice");
      expect(result.subtasks[1].title).toBe("Deploy the new microservice");
    });
  });

  // ─── Comma list decomposition ───────────────────────

  describe("comma list decomposition", () => {
    test("splits title with 3+ comma-separated items", () => {
      const input = makeInput({
        title: "Update homepage, dashboard, settings page",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Update homepage");
      expect(result.subtasks[1].title).toBe("Dashboard");
      expect(result.subtasks[2].title).toBe("Settings page");
    });

    test("handles trailing 'and' in comma list", () => {
      const input = makeInput({
        title: "Fix header, sidebar, and footer",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[2].title).toBe("Footer");
    });
  });

  // ─── Duration estimation ────────────────────────────

  describe("duration estimation", () => {
    test("distributes provided estimatedMinutes evenly across subtasks", () => {
      const input = makeInput({
        title: "Plan and execute migration",
        estimatedMinutes: 120,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].estimatedMinutes).toBe(60);
      expect(result.subtasks[1].estimatedMinutes).toBe(60);
      expect(result.totalEstimatedMinutes).toBe(120);
    });

    test("uses heuristic (30 min/subtask) when no estimate provided", () => {
      const input = makeInput({
        title: "Write docs and create tests",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
      // 2 subtasks * 30 min = 60 min total
      expect(result.totalEstimatedMinutes).toBe(60);
      expect(result.subtasks[0].estimatedMinutes).toBe(30);
      expect(result.subtasks[1].estimatedMinutes).toBe(30);
    });

    test("handles uneven distribution — remainder goes to last subtask", () => {
      const input = makeInput({
        title: "Fix bugs",
        description: `- Fix login
- Fix search
- Fix layout`,
        estimatedMinutes: 100,
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(3);
      // 100 / 3 = 33 each, last gets 33 + 1 = 34
      expect(result.subtasks[0].estimatedMinutes).toBe(33);
      expect(result.subtasks[1].estimatedMinutes).toBe(33);
      expect(result.subtasks[2].estimatedMinutes).toBe(34);
      expect(result.totalEstimatedMinutes).toBe(100);
    });

    test("duration-based splitting for large tasks (>120 min)", () => {
      const input = makeInput({
        title: "Long research task",
        estimatedMinutes: 300,
      });
      const result = decomposeTask(input);

      // 300 min / 60 min chunks = 5 parts
      expect(result.subtasks.length).toBe(5);
      expect(result.subtasks[0].title).toContain("part 1/5");
      expect(result.subtasks[4].title).toContain("part 5/5");
      expect(result.totalEstimatedMinutes).toBe(300);
    });

    test("duration-based splitting caps at 8 parts", () => {
      const input = makeInput({
        title: "Very long project",
        estimatedMinutes: 600,
      });
      const result = decomposeTask(input);

      // 600 / 60 = 10 but capped at 8
      expect(result.subtasks.length).toBe(8);
      expect(result.totalEstimatedMinutes).toBe(600);
    });
  });

  // ─── Priority inheritance ───────────────────────────

  describe("priority inheritance", () => {
    test("subtasks inherit High priority from parent", () => {
      const input = makeInput({
        title: "Review and update security policy",
        priority: "High",
      });
      const result = decomposeTask(input);

      for (const subtask of result.subtasks) {
        expect(subtask.priority).toBe("High");
      }
    });

    test("subtasks inherit Low priority from parent", () => {
      const input = makeInput({
        title: "Clean up old docs and remove stale configs",
        priority: "Low",
      });
      const result = decomposeTask(input);

      for (const subtask of result.subtasks) {
        expect(subtask.priority).toBe("Low");
      }
    });

    test("subtasks inherit Urgent priority from parent", () => {
      const input = makeInput({
        title: "Fix the crash and deploy hotfix",
        priority: "Urgent",
      });
      const result = decomposeTask(input);

      for (const subtask of result.subtasks) {
        expect(subtask.priority).toBe("Urgent");
      }
    });

    test("defaults to Medium when no priority specified", () => {
      const input = makeInput({
        title: "Something and something else",
        priority: undefined,
      });
      const result = decomposeTask(input);

      for (const subtask of result.subtasks) {
        expect(subtask.priority).toBe("Medium");
      }
    });

    test("normalizes mixed-case priority", () => {
      const input = makeInput({
        title: "Task A and Task B",
        priority: "high",
      });
      const result = decomposeTask(input);

      for (const subtask of result.subtasks) {
        expect(subtask.priority).toBe("High");
      }
    });
  });

  // ─── Feasibility scoring ────────────────────────────

  describe("feasibility scoring", () => {
    test("returns 0 for tasks that cannot be decomposed", () => {
      const input = makeInput({
        title: "Simple task",
      });
      const result = decomposeTask(input);

      expect(result.feasibilityScore).toBe(0);
      expect(result.subtasks.length).toBe(0);
    });

    test("returns higher score for description-based decomposition", () => {
      const input = makeInput({
        title: "Setup project",
        description: `1. Init repo
2. Configure CI
3. Setup deploy`,
      });
      const result = decomposeTask(input);

      // description method = 50 base + 25 method + 15 subtask-count = 90
      expect(result.feasibilityScore).toBeGreaterThanOrEqual(80);
    });

    test("returns moderate score for conjunction-based decomposition", () => {
      const input = makeInput({
        title: "Write docs and create tests",
      });
      const result = decomposeTask(input);

      // conjunction method = 50 base + 15 method + 15 subtask-count = 80
      expect(result.feasibilityScore).toBeGreaterThanOrEqual(70);
    });

    test("verb pattern decomposition gives good score", () => {
      const input = makeInput({
        title: "Review and update the API docs",
      });
      const result = decomposeTask(input);

      // verb_pattern method = 50 + 20 + 15 = 85
      expect(result.feasibilityScore).toBeGreaterThanOrEqual(80);
    });

    test("duration-based decomposition gives lower score", () => {
      const input = makeInput({
        title: "Long running task",
        estimatedMinutes: 180,
      });
      const result = decomposeTask(input);

      // duration method = 50 + 10 + 15 = 75
      expect(result.feasibilityScore).toBeLessThan(80);
      expect(result.feasibilityScore).toBeGreaterThan(50);
    });

    test("score between 0 and 100", () => {
      const inputs: TaskDecompositionInput[] = [
        makeInput({ title: "A and B" }),
        makeInput({ title: "X then Y then Z" }),
        makeInput({ title: "Simple" }),
        makeInput({
          title: "Complex",
          description: "1. Step 1\n2. Step 2\n3. Step 3\n4. Step 4\n5. Step 5",
        }),
      ];

      for (const input of inputs) {
        const result = decomposeTask(input);
        expect(result.feasibilityScore).toBeGreaterThanOrEqual(0);
        expect(result.feasibilityScore).toBeLessThanOrEqual(100);
      }
    });
  });

  // ─── Warnings ───────────────────────────────────────

  describe("warnings", () => {
    test("warns when total time exceeds time before due date", () => {
      const soon = new Date();
      soon.setMinutes(soon.getMinutes() + 30); // 30 min from now

      const input = makeInput({
        title: "Big task A and Big task B",
        estimatedMinutes: 120,
        dueAt: soon,
      });
      const result = decomposeTask(input);

      expect(result.warnings.some((w) => w.includes("exceeds available time"))).toBe(true);
    });

    test("warns when task is past due date", () => {
      const past = new Date("2020-01-01T00:00:00Z");

      const input = makeInput({
        title: "Overdue task A and overdue task B",
        dueAt: past,
      });
      const result = decomposeTask(input);

      expect(result.warnings.some((w) => w.includes("past its due date"))).toBe(true);
    });

    test("warns when decomposition cannot be performed", () => {
      const input = makeInput({
        title: "Simple undivisible task",
      });
      const result = decomposeTask(input);

      expect(result.warnings.some((w) => w.includes("Could not identify"))).toBe(true);
    });

    test("no time warning when due date is far away", () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);

      const input = makeInput({
        title: "Task X and Task Y",
        estimatedMinutes: 60,
        dueAt: future,
      });
      const result = decomposeTask(input);

      expect(result.warnings.some((w) => w.includes("exceeds available time"))).toBe(false);
    });
  });

  // ─── Sequential dependency detection ────────────────

  describe("sequential dependency detection", () => {
    test("detects sequential dependency with 'then' in title", () => {
      const input = makeInput({
        title: "Compile the code then run tests",
      });
      const result = decomposeTask(input);

      expect(result.subtasks[0].dependsOnPrevious).toBe(false);
      expect(result.subtasks[1].dependsOnPrevious).toBe(true);
    });

    test("detects sequential dependency with 'after' in description", () => {
      const input = makeInput({
        title: "Build and deploy",
        description: "Deploy after the build succeeds",
      });
      const result = decomposeTask(input);

      expect(result.subtasks[1].dependsOnPrevious).toBe(true);
    });

    test("no sequential dependency for simple 'and' tasks", () => {
      const input = makeInput({
        title: "Fix bug A and fix bug B",
      });
      const result = decomposeTask(input);

      expect(result.subtasks[0].dependsOnPrevious).toBe(false);
      expect(result.subtasks[1].dependsOnPrevious).toBe(false);
    });

    test("detects sequential dependency with Chinese '然后'", () => {
      const input = makeInput({
        title: "编译代码然后部署",
      });
      const result = decomposeTask(input);

      expect(result.subtasks[0].dependsOnPrevious).toBe(false);
      expect(result.subtasks[1].dependsOnPrevious).toBe(true);
    });
  });

  // ─── Edge cases ─────────────────────────────────────

  describe("edge cases", () => {
    test("returns empty subtasks for single-word title with no description", () => {
      const input = makeInput({
        title: "Refactor",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(0);
      expect(result.feasibilityScore).toBe(0);
    });

    test("handles empty description gracefully", () => {
      const input = makeInput({
        title: "Deploy service and run smoke tests",
        description: "",
      });
      const result = decomposeTask(input);

      expect(result.subtasks.length).toBe(2);
    });

    test("returns correct totalEstimatedMinutes even with no input estimate", () => {
      const input = makeInput({
        title: "Step 1 and Step 2 and then Step 3",
      });
      const result = decomposeTask(input);

      expect(result.totalEstimatedMinutes).toBe(
        result.subtasks.reduce((sum, s) => sum + s.estimatedMinutes, 0),
      );
    });
  });
});
