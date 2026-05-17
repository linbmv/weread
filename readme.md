<p>
  <a href="https://reader.anyin.bond" target="_blank" rel="noopener noreferrer">
    <h1 align="center">Weread</h1>
  </a>
</p>

<p align="center">
  <strong>一个以隐私优先的纯净网络阅读器</strong>
</p>
<p align="center">
<a href="https://github.com/aionfatedio/weread">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license">
</a>
<a href="https://github.com/aionfatedio/weread">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
</a>
<a href="https://github.com/aionfatedio/weread"><img src="https://img.shields.io/github/actions/workflow/status/ranuts/weread/ci.yml" alt="Build Status"></a>
<a href="https://github.com/aionfatedio/weread">
    <img src="https://img.shields.io/github/forks/ranuts/weread" alt="forks">
</a>
<a href="https://github.com/aionfatedio/weread">
    <img src="https://img.shields.io/github/stars/ranuts/weread" alt="stars">
</a>
</p>
<p align="center">
  <a href="https://reader.anyin.bond" target="_blank">🌐 在线演示</a>
</p>

---

> 本项目 复刻自 [ranuts/weread](https://github.com/aionfatedio/weread)

weread 是一个本地的网页阅读器。支持导入 TXT / EPUB 书籍，在网页中阅读、搜索、笔记、书签、进度记录和备份恢复，数据保存在浏览器 `indexedDB` 中。

### 技术栈

React 19 + Vite 7 + TypeScript + Tailwind CSS/SCSS

### 功能

- 导入 TXT / EPUB 书籍。
- 支持最近阅读、我的书架、标题搜索和正文搜索。
- 支持上下滚动阅读和双栏翻页阅读。
- 支持桌面端和移动端阅读界面。
- 支持亮色 / 暗色主题、字号、字体、页间距、首行缩进等阅读设置。
- 支持书签、划线、想法笔记。
- 支持标记阅读状态：未读、在读、读过、读完。
- 支持阅读进度、阅读时长、每日阅读统计。
- 支持单本书导出 / 恢复备份文件。
- 支持 PWA 

### 数据存储

书籍本体、EPUB 图片资源、阅读进度、笔记、书签、阅读设置、阅读时长和阅读状态保存在浏览器 IndexedDB 中。

**注意：**清理浏览器站点数据会删除本地书籍和用户数据，建议定期导出备份。

### 环境要求

- Node.js `>= 24.15.0`
- pnpm

### 安装

1. **克隆仓库**

   ```bash
   git clone https://github.com/aionfatedio/weread.git
   cd weread
   ```

2. **安装依赖**

   ```bash
   pnpm install
   ```

3. **启动开发服务器**

   ```bash
   pnpm dev
   ```

4. **打开浏览器**
   访问 `http://localhost:5173`

### 生产构建

```bash
# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

### 项目结构

```text
components/       通用组件和阅读器面板
pages/            页面入口：首页、书架、阅读页
lib/              阅读解析、进度、笔记、备份、PWA、工具函数
store/            IndexedDB 初始化和书籍数据访问
workers/          数据库和 EPUB 解析 Worker
styles/           全局样式
public/           PWA manifest、图标、SPA fallback
scripts/          构建后脚本
```

## 资源

- [Z-Library](https://z-library.sk/): 知名的影子图书馆，拥有海量的多语言多格式电子书资源，普通用户每天可下载 10 本电子书。
- [Anna's Archive](https://annas-archive.org/): 一个影子图书馆搜索引擎，其通过汇总各种来源的数据对所有现存书籍进行编目。
- [Library Genesis+](https://libgen.li/): 知名的影子图书馆，格式包含 PDF、MOBI 和 EPUB。
- [sci-hub](https://sci-hub.ru/): 世界上第一个向公众提供数千万篇研究论文的网站。输入论文 DOI 获取。
- [Trantor](https://trantor.is/): 一个 EPUB 格式的无 DRM 电子书存储库。
- [VDOC.PUB](https://vdoc.pub/): 免费外文电子书下载站点。有 EPUB、PDF、DJVU、MOBI 等多种格式。
- [PDF DRIVE](https://www.pdfdrive.com/): PDF Drive 是一个 PDF 文档搜索引擎，可免费下载，大多是 PDF 格式。
- [The Pirate Bay](https://thepiratebay.org/index.html): 可通过选择 Ebook 分类，或通过 MOBI、EPUB、AZW3 等关键字搜索想要的英文 电子书。
- [1337x](https://1337x.to/): 可通过选择 Other 分类，或通过 MOBI、EPUB、AZW3 等关键字搜索想要的英文电子书。
- [Project Gutenberg](https://www.gutenberg.org/): 免费提供 MOBI、EPUB 等格式的电子书下载。古登堡计划是世界上第一个数字图书馆，提供大量版权过期而进入公有领域的书籍（公版书）。[这里](https://www.gutenberg.org/browse/languages/zh)也提供一些中文版公版书下载。
- [Standard Ebooks](https://standardebooks.org/ebooks): 免费提供重制的精校公版电子书，提供 EPUB、AZW3 和 KPEUB 格式。
- [DigiLibraries](https://digilibraries.com/): 免费电子 书库，超过 20,000 本免费 电子书，提供 MOBI、EPUB、PDF 等格式电子书。
- [MobileRead（EPUB 格式）](https://www.mobileread.com/forums/forumdisplay.php?f=130): MobileRead 论坛的无版权 EPUB 格式电子书上传区，无需注册可直接下载。
- [MobileRead（MOBI 格式）](https://www.mobileread.com/forums/forumdisplay.php?f=128): MobileRead 论坛的无版权 MOBI 格式电子书上传区，无需注册可直接下载。
- [epubBooks](https://www.epubbooks.com/): 提供高质量 EPUB 格式和适用于 Kindle 的 MOBI 格式公版电子书，其中有许多办好插图和脚注。下载电子书前必须使用邮箱注册并激活账号。
- [Planetebook](https://www.planetebook.com/): 免费英文电子书下载站点。有 EPUB、MOBI、PDF 格式。
- [Girlebooks](https://girlebooks.com/): 免费的女性作家电子书，提供适合 Kindle 阅读的 PRC 格式，以及 EPUB、PDF、微软阅读器、PDB 和纯文本格式。
- [Green Tea Press](https://greenteapress.com/wp/): 免费提供《Think Python》、《Think Bayes》等英文原版电子书的下载，这些电子书允许读者复制、分发其内容，也可以根据不同的需求自由地对其进行编辑，并帮助扩展新内容。
- [Baen Free Library](http://www.baen.com/library/): 提供免费的科幻、奇幻类书籍。提供在线阅读，也提供多格式下载，如 HTML、MOBI、EPUB、RTF、SONY 电子书格式、微软阅读器格式等。
- [Let Me Read](https://www.letmeread.net/): 英文 电子书下载站点。有 EPUB、MOBI、PDF 格式，在页面底部的 Free sample 处下载。
- [CODERPROG](https://coderprog.com/): 英文 电子书下载站点。有 EPUB、MOBI、PDF 格式，在页面底部的 Free sample 处下载。

### 中文 (简体)

- [Jiumo Search](https://www.jiumodiary.com/)：众多电子书资源一站式的整合搜索。提供各种电子书格式，text、PDF、mobi、epub 等等都有，每条分享点开就是网盘链接
- [搬书匠](http://www.banshujiang.cn/): 主要提供编程类书籍的下载，据程序员朋友反馈上面的书籍还是比较齐全的，有需要的伙伴可以去逛逛。
- [SaltTiger](http://www.salttiger.com/): 最新出版的计算机技术类电子 书。提供 MOBI、PDF、EPUB 格式下载。

### 中文 (繁體)

- [好讀](https://www.haodoo.net/)：中文电子书公益网站，提供 mobi、epub 等格式电子书下载。
- [Kmoe](https://mox.moe/)：漫画迷值得拥有

### 许可

MIT
