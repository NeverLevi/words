# 六级编辑部

把六级词库变成一间轻量的英文编辑部：每个单词依次经过收稿、核义、配稿、返审、入文和签发，完成后进入刊发档案。

## 本地运行

```bash
npm install
npm run dev
```

构建与测试：

```bash
npm test
npm run build
```

## 词库

`public/vocabulary/manifest.json` 管理 7,803 个 PDF 词条的静态分包，`public/vocabulary/import-report.json` 保存逐次导入校验结果。重新生成词库时，通过环境变量指定原始文件：

```bash
CET6_PDF=/path/to/list.pdf CET6_JSONL=/path/to/dictionary.jsonl npm run data:build
```

PDF 是完整清单和释义来源，JSONL 仅补充能精确匹配的音标、例句、搭配和近义词。重复词条保留独立编号。用户进度保存在浏览器 IndexedDB，并可从设置页导出和导入。
