# 六级编辑部

把六级词库变成一间轻量的英文编辑部：每个单词依次经过收稿、核义、配稿、返审、入文和签发，完成后进入刊发档案。

在线打开：<https://neverlevi.github.io/words/>

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

生产构建会生成 `dist/` 静态部署目录，并自动生成离线缓存清单。把 `dist/` 内的文件上传到任意支持 HTTPS 的静态网站空间后，用 iPhone Safari 打开一次，再选择“分享 → 添加到主屏幕”，即可离线使用完整词库。静态空间无需连接 GitHub；重新上传新版本后，缓存会自动更新。

## 词库

`public/vocabulary/manifest.json` 管理 7,803 个 PDF 词条的静态分包，`public/vocabulary/import-report.json` 保存逐次导入校验结果。重新生成词库时，通过环境变量指定原始文件：

```bash
CET6_PDF=/path/to/list.pdf CET6_JSONL=/path/to/dictionary.jsonl npm run data:build
```

PDF 是完整清单和释义来源，JSONL 仅补充能精确匹配的音标、例句、搭配和近义词。重复词条保留独立编号。用户进度保存在浏览器 IndexedDB，并可从设置页导出和导入。

缺失字段的离线补全使用 ECDICT、Princeton WordNet、CMU Pronouncing Dictionary 和 NLTK 英语语料；现代词、英式拼写及专业派生词使用 `scripts/curated-overrides.mjs` 中的审核内容。准备好 ECDICT CSV 与 NLTK 语料目录后可运行 `npm run data:enrich`。
