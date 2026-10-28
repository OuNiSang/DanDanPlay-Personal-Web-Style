# DanDanPlay Personal Web Style 安装包

版本：3.5
兼容目标：弹弹play Windows 18.1.3（发布检查版本 18.1.3.0）。

1. 完整解压 ZIP。不要直接在压缩包内运行。
2. 建议先退出弹弹play。
3. 双击 `manage-style.bat`，选择 `1` 安装或重新应用。
4. 在弹弹play中开启远程访问，用浏览器进入客户端显示地址的 `/web1/index.html`。
5. 需要回退时，再次运行管理器并选择 `2`；选择 `3` 查看版本和安装状态。

管理器自动备份受覆盖的文件，恢复时也会清除本次安装新增的文件。版本不匹配时会提示确认；请保留备份，不要随意跳过版本检查。手机和窄屏自动使用稳定布局。

本 ZIP 包含 manifest 列出的运行文件与第三方许可及安装、回退所需的管理器。不包含弹弹play主程序、媒体、账号、服务器配置、播放记录、开发文档、截图或 GIF；依赖弹弹play自带的 Web1 基础资源。

SHA-256 校验值位于同一 Release 的 `.zip.sha256` 附件。

项目说明、界面预览与更新记录：[GitHub 项目主页](https://github.com/OuNiSang/DanDanPlay-Personal-Web-Style)

下载次数是附件请求次数，不等于独立安装人数。本项目不通过该安装包收集用户媒体库或使用遥测。

软件解码：固定 libmedia AVPlayer 1.3.1 已获用户验收通过。E-AC-3 直接解码，不生成媒体副本。播放器下方可切回原生，或在视频 URL 增加 `decoder=native`。软解码暂不支持高级 ASS 字幕、原生画中画/AirPlay/截图；手机及长时性能并未全面验证。第三方来源和许可见 `payload/js/vendor/libmedia-1.3.1/NOTICE.txt`。
