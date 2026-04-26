import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
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
            "@chrona/openclaw-integration*",
            "@chrona/runtime-openclaw*"
          ]
        }
      ]
    }
  },
  globalIgnores([
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "agent-dashboard-app/**",
  ]),
]);

export default eslintConfig;
