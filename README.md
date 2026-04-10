# Meeting Copilot

一个本地可运行的英文会议副驾驶。

现在这版的产品形态是：

- 左侧保留每次会议
- 中间持续记录英文原文
- 点击任意一行原文可回听对应录音
- 右侧给中文理解和接话提示
- 会议结束后，AI 总结和可编辑笔记接在文档底部

## 分享给别人

最适合的分享方式有两种：

1. 发 Git 仓库
   - 最适合长期协作
   - 不要提交 `.env`
   - `models/*.bin` 默认也不会提交，别人第一次运行时会自己下载模型

2. 打包成 zip 发给测试者
   - 最适合快速内测
   - 如果你愿意，也可以把 `models/ggml-base.en.bin` 一起打进去，这样对方少一步下载

如果是发 GitHub，推荐直接把这个目录推上去，然后把下面这段“本地部署”一起发给对方。

## 本地部署

### 适用环境

当前最顺手的是 `macOS + Chrome/Edge`。

对方本机最好有：

- Node.js
- Homebrew
- Chrome 或 Edge

### 最简单的启动方法

```bash
git clone <your-repo-url>
cd meeting-copilot-mvp
npm run setup:mac
node server.js
```

然后打开：

```text
http://localhost:3000
```

`npm run setup:mac` 会做这些事：

- 检查 Node.js 和 Homebrew
- 自动创建 `.env`
- 安装 `ffmpeg`
- 安装 `whisper-cpp`
- 下载本地转写模型到 `models/`

## 手动部署

如果对方不想跑一键脚本，也可以手动来。

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 安装本地 STT：

```bash
chmod +x scripts/setup-local-stt.sh
./scripts/setup-local-stt.sh
```

3. 启动服务：

```bash
node server.js
```

4. 打开浏览器：

```text
http://localhost:3000
```

## API Key 说明

这项目现在支持两种分析方式：

1. `OPENAI_API_KEY`
   - 在 `.env` 里填 `OPENAI_API_KEY`
   - 分析和总结走官方 API

2. 本机 `Codex / ChatGPT` 登录态
   - 如果对方机器上已经登录过 Codex
   - 即使没填 `OPENAI_API_KEY`
   - `秘书分析` 和 `会后总结` 也能工作

实时转写默认优先走本地 `whisper.cpp`，所以不一定需要 API key。

## 给测试者的最短说明

你可以直接把这段发给别人：

```text
这是一个本地运行的会议助手。请先安装 Node.js、Homebrew 和 Chrome。
然后在终端里执行：

git clone <repo>
cd meeting-copilot-mvp
npm run setup:mac
node server.js

最后打开 http://localhost:3000
```

## 当前边界

- 最适合 `2 到 3 人` 轮流说话
- 说话人标签目前是 `Speaker A / B / C`
- 不绑定真实姓名
- 本地说话人区分是启发式聚类，抢话和重叠说话时还不算强
- 当前会议数据主要在前端内存里，刷新页面后不会长期保存

## 常用命令

```bash
npm run setup:mac
npm run setup:local-stt
npm start
```
