# DanDanPlay Personal Web Style

弹弹play Web1 的非官方影视化界面改版。保留原有媒体库、播放记录和 API 行为，重新组织首页 Hero、分区导航、更新时间轴、媒体库列表，并适配桌面端、手机竖屏以及明暗主题。

![桌面端 Hero](screenshots/hero-desktop-2.4.png)

## 界面预览

### 最近更新时间轴

![最近更新时间轴](screenshots/recent-updates-desktop-2.4.png)

### 最近关注

![最近关注](screenshots/recent-follows-desktop-2.4.png)

### 媒体库罗列

![桌面端媒体库](screenshots/library-desktop.jpg)

| 手机端首页 | 手机端媒体库 |
| --- | --- |
| ![手机端首页](screenshots/home-mobile.jpg) | ![手机端媒体库](screenshots/library-mobile.jpg) |

## 主要特性

- 全屏影视化 Hero，支持真实媒体库内容与多来源图片切换。
- 桌面端分区阶梯滚动，手机端保留原布局与自然滑动。
- 横向分组更新时间轴，以及更高信息密度的观看和关注列表。
- 优化最近更新时间轴的日期分组、坐标对齐、密集海报分布和观看状态标记。
- 最近关注会按实际桌面列数动态渲染，避免最后一行空缺。
- 首页与子页面使用统一导航，并保持各页面原有路由和数据逻辑。
- 完整适配深色、浅色主题与 `prefers-reduced-motion`。
- 默认中文的一键管理器，可在菜单内切换英文。
- 安装前自动读取本机弹弹play版本，并在版本不兼容时警告。
- 一键安装、升级后重新应用，以及一键恢复安装前文件。

## 安装与回退

1. 从 GitHub Releases 下载源码压缩包并完整解压，不能直接在压缩包内运行。
2. 建议先退出弹弹play。
3. 双击 [`manage-style.bat`](manage-style.bat)。
4. 选择 `1` 安装或重新应用界面；选择 `2` 恢复最近一次安装前的文件。

管理器默认使用中文；在主菜单选择 `4` 可以切换到英文。

安装前，管理器会优先读取 Web1 目录同级的 `dandanplay.exe` 版本，并以运行进程和 Windows 安装信息作为后备来源。检测结果与当前界面适配版本不一致，或无法识别版本时，会先显示警告并要求确认，不会静默覆盖。

脚本会自动定位 `%APPDATA%` 下的弹弹play Web1 目录。每次检测到官方文件或版本更新后的文件与覆盖包不同时，会先备份再安装。备份保存在：

```text
%LOCALAPPDATA%\DanDanPlay-Personal-Web-Style\backups
```

弹弹play版本更新覆盖网页后，再次运行脚本并选择 `1` 即可恢复界面。此时脚本会先保存更新后的官方文件，因此选择 `2` 可以退回对应的新版本官方界面。

> 跨大版本更新时，弹弹play可能调整 Web1 模板或 API。建议先使用菜单中的状态检查，并保留自动生成的备份。

## 更新说明

### 2.4

- 放大并重新排布首页 `最近更新` 卡片，优化时间轴左右贯穿、日期分组和入场动画。
- 为 `最近更新` 卡片加入未开始、观看中和已看完状态标记，并保持暗金视觉基调。
- 修复 `最近关注` 在 14/18/12 列桌面布局下最后一行无法填满的问题。

### 2.3

- 修复移动端媒体库搜索入口在紧凑布局下不可达的问题。
- 调整首页 `最近更新` 时间轴的对齐、日期分组和密集海报分布。
- 记录并沿用 Web1 源码仓库与公开发布包仓库分离的发布流程。

## 当前覆盖范围

当前发布版本：`2.4`，基于弹弹play `18.1.0` Web1 调整。

公开包只包含改版实际需要覆盖或新增的文件：

```text
bangumi.html
filelist.html
index.html
style.sshtml
css/home-v18.css
css/main.css
js/library-navigation.js
```

没有附带媒体库数据、账号配置、服务器地址、播放记录或弹弹play自带的第三方前端依赖。

## 手动使用

需要自定义目标目录时，可直接调用管理脚本：

```powershell
pwsh -NoProfile -File .\scripts\manage-style.ps1 -Action install -TargetPath "D:\path\to\web"
pwsh -NoProfile -File .\scripts\manage-style.ps1 -Action restore -TargetPath "D:\path\to\web"
pwsh -NoProfile -File .\scripts\manage-style.ps1 -Action status -TargetPath "D:\path\to\web"
```

Windows PowerShell 5.1 同样可用。

命令行默认输出中文；可通过 `-Language en-US` 使用英文。非交互安装遇到版本不匹配时会安全退出，只有明确添加 `-Force` 才会继续：

```powershell
pwsh -NoProfile -File .\scripts\manage-style.ps1 -Action install -Force
```

## 声明

本项目是个人维护的非官方界面修改，与弹弹play官方无隶属或背书关系。界面中展示的作品图片由用户自己的媒体库与相应元数据服务提供，本仓库不分发番剧图片或媒体内容。
