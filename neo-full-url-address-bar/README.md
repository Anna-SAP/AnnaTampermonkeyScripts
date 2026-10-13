# Neo 工具栏调整：完整 URL、全宽地址栏、缩放按钮

`Set-NeoFullUrlAddressBar.ps1` 对 Norton Neo 的工具栏做三处调整：

- 地址栏始终显示完整 URL（含 `https://`、路径、查询参数和 `#` 片段），不再只显示域名，并拉伸到工具栏全宽。
- 移除工具栏最左侧的「垂直选项卡」切换按钮。
- 在地址栏右侧新增页面缩放按钮：角标显示当前缩放比例，点开是 `− 110% +` 面板。

## 为什么不是 Tampermonkey 脚本

Neo 的工具栏是浏览器自身界面（地址栏是 `chrome://` 顶层 WebUI 里的 `<readonly-omnibox>` 组件），不属于任何网页。
Tampermonkey 等扩展被浏览器禁止注入这类界面，用户脚本改不到它，只能通过浏览器级配置实现。

## 原理

| 改动 | 作用 |
| --- | --- |
| 启动参数 `--disable-features=NavigatorReadOnlyOmnibox` | 关闭 Neo 的「只读地址栏」，换回标准 Chromium 地址栏，不再只显示域名 |
| 启动参数 `--disable-features=NeoVerticalTabs` | 移除工具栏最左侧的垂直选项卡按钮 |
| 启动参数 `--load-extension=%LOCALAPPDATA%\NeoToolbarTweaks\zoom-controls` | 加载缩放按钮扩展 |
| 偏好 `omnibox.prevent_url_elisions = true` | 始终显示完整 URL（等同 Chrome 地址栏右键「始终显示完整网址」） |
| 偏好 `navigator.omnibox.use_full_width = true` | 地址栏占满宽度（等同 Neo Preferences 里的「Use full address bar width」） |
| 偏好 `navigator.omnibox.show_title = false` | 不用页面标题替代 URL |
| 偏好 `extensions.pinned_extensions` | 把缩放按钮固定在地址栏右侧第一个位置，其他已固定的扩展保持不变。登录了同步账号的 profile 以 `account_values` 下的账号层列表为准，脚本会同时写入两份列表 |

启动参数会写入这些位置：

- 指向 `neo.exe` 的快捷方式：任务栏固定、开始菜单、桌面
- Neo 作为默认浏览器时打开链接的命令：在 `HKCU\Software\Classes\NeoHTM`、`NeoPDF` 下新建用户级覆盖项，不改动 HKLM，也不需要管理员权限

## 缩放按钮

- 缩放比例不是默认值时，按钮角标显示当前比例（例如 `110`）。用 Ctrl + 滚轮或快捷键缩放时，角标也会同步更新。
- 点击按钮打开面板：`−` 缩小，`+` 放大，点中间的百分比恢复默认。面板打开时也可以直接按 `+`、`-`、`0`。
- 缩放档位与 Ctrl + 加号 / 减号相同（25% 至 500%）。
- Chromium 的扩展按钮只能放在地址栏右侧的扩展区，无法像 Firefox 那样把 `− 110% +` 直接嵌进工具栏，所以采用「按钮 + 面板」的形式。
- 扩展源码在 [`zoom-controls/`](zoom-controls/)，不申请任何权限。脚本会把它复制到 `%LOCALAPPDATA%\NeoToolbarTweaks\zoom-controls` 再加载，所以之后移动或删除仓库都不影响使用。

## 使用

启动参数和快捷方式的改动只对当前电脑有效，换一台电脑需要重新运行一次。

### 1. 准备

- 已安装 Neo，并且至少正常打开、关闭过一次，这样才会生成 profile。
- 如果习惯从任务栏打开 Neo，先把 Neo 固定到任务栏再运行脚本。之后新固定的快捷方式不带启动参数，需要再运行一次。
- 需要 PowerShell 7.2+。用 `pwsh -v` 确认版本，没有的话用 `winget install Microsoft.PowerShell` 安装。

### 2. 获取脚本

需要整个 `neo-full-url-address-bar` 目录（脚本加上 `zoom-controls` 扩展）。只有脚本文件时，缩放按钮会被跳过，其余调整照常应用。

推荐克隆整个仓库：

```bash
git clone https://github.com/Anna-SAP/AnnaTampermonkeyScripts.git
cd AnnaTampermonkeyScripts
```

也可以在 GitHub 仓库页面点 **Code → Download ZIP** 下载后解压。用浏览器下载的文件会被 Windows 标记为「来自网络」，PowerShell 会拒绝运行，需要先在解压后的目录里解除标记：

```bash
pwsh -Command "Get-ChildItem -Recurse | Unblock-File"
```

### 3. 运行

以下命令在仓库根目录执行。

1. 完全退出 Neo（包括后台进程），否则 Neo 退出时会覆盖偏好改动。脚本检测到 Neo 仍在运行时会拒绝执行。
2. 先预览，不写入任何改动。确认列出了任务栏快捷方式和 `NeoHTM`：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -WhatIf
   ```

3. 正式应用，然后从任务栏或开始菜单重新打开 Neo：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1
   ```

### 只要部分调整

- `-KeepVerticalTabsButton`：保留垂直选项卡按钮。
- `-NoZoomControls`：不要缩放按钮。

已经应用过的电脑加上这两个参数重新运行，就会移除对应的调整，例如：

```bash
pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -KeepVerticalTabsButton
```

### 从旧版升级

用过旧版（只有完整 URL 和全宽地址栏）的电脑，先 `git pull` 更新仓库，再按「3. 运行」重新运行一次。脚本会在原有设置上补充新的启动参数。之后仓库里的缩放扩展有更新时，也是重新运行脚本来同步。

### 撤销

```bash
pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -Undo
```

撤销会还原全部启动参数和偏好项，取消固定缩放按钮，并删除 `%LOCALAPPDATA%\NeoToolbarTweaks`。
首次修改 `Preferences` 前，脚本会在同目录备份一份 `Preferences.before-neo-full-url.bak`。
可用 `-SkipPreferences`、`-SkipShortcuts`、`-SkipUrlHandlers` 跳过某一部分。

## 常见问题

- **提示「未找到 Neo」**：Neo 没有装在默认的 `C:\Program Files\Neo\Application\neo.exe`（例如装在了用户目录下）。用 `-NeoExe` 加上 `neo.exe` 的实际路径重新运行。
- **提示「未找到 zoom-controls」**：只拿到了脚本文件，按「2. 获取脚本」获取整个目录后重新运行。
- **预览里没有列出快捷方式**：任务栏图标可能是在运行脚本之后才固定的，固定后重新运行。
- **缩放按钮不在工具栏上**：点工具栏的拼图图标，找到「Neo Zoom Controls」并固定一次。登录了同步账号时，脚本写入的固定状态可能被同步覆盖；在拼图菜单里手动固定由 Neo 自己写入账号层，会随同步保存。
- **运行后仍然只显示域名，或左侧按钮还在**：先完全退出 Neo，再从任务栏或开始菜单打开。如果还是不行，在地址栏打开 `chrome://settings/help` 查看 Neo 版本：两个特性名只在 154.0.8603.100 上确认过。

## 注意

- 开始菜单里的「所有用户」快捷方式（`C:\ProgramData\...\Neo.lnk`）需要管理员权限才能修改；普通权限下运行会跳过它并给出提示。
- 启动参数只在 Neo 冷启动时生效。如果 Neo 被其他途径启动（例如更新后自动重启），三项调整都会暂时消失，完全退出后从任务栏重新打开即可恢复，缩放按钮的固定位置也会保留。
- Neo 更新可能重建快捷方式或默认浏览器注册项，届时重新运行脚本即可，重复运行不会重复写入。
- 关闭只读地址栏后，地址栏变为可直接编辑的标准地址栏，点击和输入时的交互可能与原来不同（这部分未逐项验证）。
- 移除垂直选项卡按钮后，就无法再切换到垂直选项卡。智能分组不受影响，可以在 Neo Preferences 里开关。
- 特性名 `NavigatorReadOnlyOmnibox` 和 `NeoVerticalTabs` 都基于 Neo 154.0.8603.100 实测确认。如果 Neo 以后改名或移除了它们，需要重新确认。
