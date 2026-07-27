import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript files: the compiler already checks for undefined identifiers
    // and redeclarations, so the JS-oriented core rules here only produce
    // false positives (e.g. `no-undef` on `window`/`fetch`/`setTimeout`).
    // typescript-eslint explicitly recommends disabling them for TS.
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-undef": "off",
      "no-redeclare": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "unused-imports": unusedImports,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "unused-imports/no-unused-imports": "error",

      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "unused-imports/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      "no-unreachable": "error",
      "no-constant-condition": "warn",

      "max-lines": [
        "warn",
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "warn",
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],
      "max-statements": ["warn", 50],
    },
  },
  {
    files: [
      "apps/**/*.ts",
      "apps/**/*.tsx",
      "packages/**/*.ts",
      "packages/**/*.tsx",
      "scripts/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        // A `default` branch is a deliberate catch-all for the union members
        // a switch does not handle (these switches map a subset and return
        // null otherwise). Treat that as exhaustive instead of demanding a
        // case per member.
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
      "**/*.spec.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Test bodies favor explicit scenario setup and assertions. Applying
      // production complexity/size budgets here obscures actionable source
      // warnings and makes the global CI warning ratchet depend on test count.
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "max-depth": "off",
      "max-params": "off",
      "max-statements": "off",
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react/*",
            "@/lib/db",
            "@/generated/prisma/*",
            "@prisma/*",
            "@chrona/*-integration*",
            "@chrona/runtime-*-provider*",
          ],
        },
      ],
    },
  },
  globalIgnores([
    "**/.git/**",
    "**/.worktrees/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/out/**",
    "**/dist/**",
    "**/coverage/**",
    "**/*.min.js",
    "agent-dashboard-app/**",
    // Generated Playwright HTML report (minified third-party bundles) and the
    // throwaway audit scratch dir are not shipped source — linting them only
    // produced thousands of false positives.
    "playwright-report/**",
    "agent-test-runs/**",
    ".understand-anything/**",
    ".tmp/**",
    "packages/db/src/generated/prisma/**",
    ".dependency-cruiser.cjs",
  ]),
]);

export default eslintConfig;
