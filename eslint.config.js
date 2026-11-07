import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'apps/web/**', // 前端 UI 由外部 Codex 维护，本轮不纳入 lint
      'research/**',
      'logs/**', // 本地临时验证脚本（gitignored），不参与 lint
      'review-assets/**', // 本地验收截图与临时脚本（gitignored），不参与 lint
      '**/dist/**',
      '**/release/**', // electron-builder 打包产物（gitignored），不参与 lint
      '**/release-*/**', // 另建输出目录的打包产物，同上
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
