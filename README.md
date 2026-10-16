# 天線開放式課程講義

[![PDF 建置與發布](https://github.com/notbeloser/NTUT_Antenna_Open_Course/actions/workflows/pdf-release.yml/badge.svg)](https://github.com/notbeloser/NTUT_Antenna_Open_Course/actions/workflows/pdf-release.yml)

本專案是我個人整理的天線開放式課程中文精華講義，供自學、影片對照與複習使用。

課程來源為陳晏笙老師的[「天線」開放式課程](https://www.youtube.com/playlist?list=PL68D2uCy1WTMR9iwyjtOZcjGMom4KZEhZ)。本 repo 收錄課程導讀及 28 個單元，每份講義均提供 Markdown 閱讀版本。

## 閱讀方式

建議先閱讀[課程導讀與目錄](notes/000_課程導讀與目錄.md)，再依單元順序學習：通訊與輻射基礎、電路參數、匹配網路、輻射參數、天線家族，最後進入天線陣列。

每個單元以老師投影片的頁序為正文主線，使用中文說明觀念、公式條件、關鍵推導、圖表與課堂例題，並整合對應的口述及板書。首頁提供原始講義、頁碼及影片定位；自行補充的算例、查表資料與自測集中章末，與老師的課堂內容區分。圖上近似讀值、代數重算值與實測數據也會分別標示。

公式採用 [GitHub 支援的數學語法](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)，建議直接在 GitHub 閱讀。「講義頁碼」指老師原始 PDF 的頁碼，不是本專案輸出 PDF 的頁數；重新建置後的頁數會隨內容與排版變動。

老師的六份講義分別對應單元 01–03、04–11、12–14、15–20、21–22、23–28；來源與頁碼索引見[課程導讀](notes/000_課程導讀與目錄.md)。單元 01 保留完整射頻圖符與調變圖，單元 02 保留反射／散射／繞射尺寸對照與四頁 Fading 推導。

## PDF 下載

前往 [GitHub Releases](https://github.com/notbeloser/NTUT_Antenna_Open_Course/releases) 下載各份 PDF，或下載 `antenna-course-pdfs.zip` 取得整套講義。Release 提供中文講義下載目錄與附件標籤；下載的單份附件使用 ASCII 檔名與路徑雜湊，避免 GitHub 重寫特殊字元造成撞名。ZIP 保留原始目錄結構及完整中文檔名。

每次 push 到 `master`，GitHub Actions 都會將所有受 Git 追蹤的 `.md` 轉成 PDF，包含 README、導讀與各單元。一個 push 包含多個 commits 時，以最後一個 commit 的內容建置。每次成功建置會建立 `pdf-<完整 commit SHA>` 的獨立 Release，保留歷史版本；全部 PDF 與 ZIP 上傳完整後才公開。最新主分支版本會標示為 Latest。

也可以在 [Actions 頁面](https://github.com/notbeloser/NTUT_Antenna_Open_Course/actions/workflows/pdf-release.yml) 選擇 `master`，手動執行 **Run workflow**。若建置或上傳失敗，可重跑該次執行；發布流程會修復未完成的 draft，並驗證已發布版本的附件，避免同一 commit 重複發布。連續推送的發布工作會依序排隊，GitHub 的佇列上限為 100 個待發布工作。

### 在本機產生 PDF

需要 Node.js 24 以上、[Pandoc 3.8.3](https://github.com/jgm/pandoc/releases/tag/3.8.3)、Python 3，以及繁體中文 Noto 字型。Ubuntu 可先執行 `sudo apt-get install fonts-noto-cjk`，再於專案根目錄執行：

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:pdf
npm run build:pdf
```

PDF 位於 `dist/pdf/`，整套 ZIP 位於 `dist/assets/antenna-course-pdfs.zip`。若 Pandoc 不在 PATH，可透過 `PANDOC_PATH` 指定執行檔。數學排版使用本地 MathJax；PDF 保留插圖及影片連結，講義間的 Markdown 連結則指向對應 commit 的 GitHub 版本。

## 檔案配置

- `notes/`：課程導讀與各單元的 Markdown 講義。
- `notes/images/`：講義使用的圖表、示意圖與射頻符號，包含 PNG 圖片與 SVG 原稿。

下載 Markdown 時請一併保留 `notes/images/`，以顯示講義中的插圖。

## 講義目錄

| 單元 | 主題 | Markdown |
| --- | --- | --- |
| 導讀 | 課程導讀與目錄 | [閱讀](notes/000_課程導讀與目錄.md) |
| 01 | 無線通訊系統的基頻模組 | [閱讀](notes/001_無線通訊系統的基頻模組.md) |
| 02 | 無線通訊系統的射頻模組 | [閱讀](notes/002_無線通訊系統的射頻模組.md) |
| 03 | 電磁波輻射的原因 | [閱讀](notes/003_電磁波輻射的原因.md) |
| 04 | 傳輸線理論概述 | [閱讀](notes/004_傳輸線理論概述.md) |
| 05 | 傳輸線理論的頻域深入探討 | [閱讀](notes/005_傳輸線理論的頻域深入探討.md) |
| 06 | 電壓駐波比 | [閱讀](notes/006_電壓駐波比.md) |
| 07 | 史密斯圖（一） | [閱讀](notes/007_史密斯圖（一）.md) |
| 08 | 史密斯圖（二） | [閱讀](notes/008_史密斯圖（二）.md) |
| 09 | 史密斯圖（三） | [閱讀](notes/009_史密斯圖（三）.md) |
| 10 | 有損傳輸線分析 | [閱讀](notes/010_有損傳輸線分析.md) |
| 11 | 天線阻抗 | [閱讀](notes/011_天線阻抗.md) |
| 12 | 基本觀念與集總元件匹配法 | [閱讀](notes/012_基本觀念與集總元件匹配法.md) |
| 13 | 傳輸線殘段匹配法 | [閱讀](notes/013_傳輸線殘段匹配法.md) |
| 14 | 寬頻匹配網路與額外損耗分析 | [閱讀](notes/014_寬頻匹配網路與額外損耗分析.md) |
| 15 | 極化 | [閱讀](notes/015_極化.md) |
| 16 | 場型 | [閱讀](notes/016_場型.md) |
| 17 | 指向性 | [閱讀](notes/017_指向性.md) |
| 18 | 效率、增益與綜合評析 | [閱讀](notes/018_效率、增益與綜合評析.md) |
| 19 | 鏈路預算分析 | [閱讀](notes/019_鏈路預算分析.md) |
| 20 | 天線參數的理論極限 | [閱讀](notes/020_天線參數的理論極限.md) |
| 21 | 線型天線 | [閱讀](notes/021_線型天線.md) |
| 22 | 孔徑天線 | [閱讀](notes/022_孔徑天線.md) |
| 23 | 場型相乘法則 | [閱讀](notes/023_場型相乘法則.md) |
| 24 | 兩單元陣列 | [閱讀](notes/024_兩單元陣列.md) |
| 25 | 均勻N單元線性陣列（一） | [閱讀](notes/025_均勻N單元線性陣列（一）.md) |
| 26 | 均勻N單元線性陣列（二） | [閱讀](notes/026_均勻N單元線性陣列（二）.md) |
| 27 | 饋入權重的分析與智慧型天線 | [閱讀](notes/027_饋入權重的分析與智慧型天線.md) |
| 28 | 陣列的頻率響應觀點 | [閱讀](notes/028_陣列的頻率響應觀點.md) |
