# 臘八粥食材試算表整合

來源程式：`../sdgs-laba-calculator`（v1.1.0）。沿用原有 React 程式及計算公式。

入口：`/tools/laba`。頁面提供「返回智慧工具箱」連結。

在來源專案目錄、已安裝套件的環境中執行：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --base=/static/tools/laba/ --outDir=../sdgs-action-platform/app/static/tools/laba
```

來源專案新增 `postcss.config.js`，使 Tailwind 樣式一併編譯。
正式檔案位於 `app/static/tools/laba/`，由主平台一同部署。
