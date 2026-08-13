import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "src/seed.ts",
            "src/*.test.ts",
            "src/lib/*.test.ts",
            "src/routes/*.test.ts",
            "src/services/*.test.ts",
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
