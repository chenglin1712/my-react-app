import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'backend/staticfiles/**', 'backend/fastAPI/**', 'backend/**'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '19.2' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // react-hooks v7 新增的 React Compiler 規則，專案未使用 React Compiler，降為 warn
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'off',
      'react-hooks/static-components': 'warn',
    },
  },
  // WP-8 追加：frontend/src/_admin/testing/ 是測試專用輔助（自動確認對話框、列操作查詢），
  // 非測試檔不得引用，避免它被打包進正式程式碼。
  // 範圍是整個 frontend/src，不只 _admin：前台頁面（例如 pages/*）引用一樣會被打包進去。
  // no-restricted-imports 只看靜態 import／export…from，動態 import('…') 不在它的檢查範圍，
  // 所以另外用 no-restricted-syntax 針對 ImportExpression 的來源字串（含不帶插值的樣板字串）擋。
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    ignores: ['**/*.{test,spec}.{js,jsx}', 'frontend/src/_admin/testing/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/testing', '**/testing/**'],
          message: '_admin/testing/ 只給測試檔使用，正式程式碼不可引用。',
        }],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: 'ImportExpression[source.value=/(^|\\/)testing(\\/|$)/]',
          message: '_admin/testing/ 只給測試檔使用，正式程式碼不可動態引用。',
        },
        {
          selector: 'ImportExpression > TemplateLiteral.source > TemplateElement[value.raw=/(^|\\/)testing(\\/|$)/]',
          message: '_admin/testing/ 只給測試檔使用，正式程式碼不可動態引用。',
        },
      ],
    },
  },
]
