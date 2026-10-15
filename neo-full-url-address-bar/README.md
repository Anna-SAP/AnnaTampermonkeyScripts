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
- Neo 作为默认浏览器时打开链接的命令：Neo 装在 Program Files 时，在 `HKCU\Software\Classes\NeoHTM`、`NeoPDF` 下新建用户级覆盖项，不改动 HKLM，也不需要管理员权限；Neo 装在用户目录时，注册项带安装 ID 后缀（如 `NeoHTM.QS4PLG…`），直接修改当前用户下的这些注册项
- 当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下已经存在、直接启动该 Neo 的命令（例如 Neo 设置里开启开机启动后生成的 `NeoAutoLaunch_…`），保留原有 profile、后台启动等参数，不新增 Neo 自启动。漏掉这一项时，开机后 Neo 会先以不带参数的方式启动，之后再点任务栏图标也只是切换到这个实例，工具栏调整全部失效。

## 跨设备和重启后使用

旧版的两个问题需要分开处理：固定的 `C:\Program Files\Neo\Application\neo.exe` 不适用于所有电脑；工具栏依赖启动参数，首次启动 Neo 的入口没有参数时，之后点带参数的快捷方式也不能改变已经运行的实例。更新器也可能重建快捷方式或默认链接命令。仅重复传 `-NeoExe` 只能解决前一个问题。

新版不再要求 Neo 安装在固定位置：

- 自动检查当前用户 Neo 进程、Windows App Paths、浏览器注册命令、快捷方式、用户目录/Program Files 常见位置和 PATH；同时检查 32/64 位注册表视图。只接受存在的 `neo.exe`，不遍历整个磁盘。
- 每次启动增强入口都重新定位 Neo；首次明确指定的 `-NeoExe` 会作为本机选择保留，程序移走后再自动发现。多套 Neo 共存时可用 `-NeoExe` 明确选择。
- 把运行脚本、缩放扩展和本机设置部署到 `%LOCALAPPDATA%\NeoToolbarTweaks`。应用后移动或删除下载目录，不影响增强入口和登录修复。
- 在当前用户开始菜单创建 **Neo（工具栏增强）**，每次打开前先修复已有启动入口，再携带参数启动 Neo。日常建议从这个入口打开。
- 默认在当前用户「启动」目录创建 **Neo 工具栏自动修复**。登录时只维护启动入口，不打开/关闭 Neo，也不写 Preferences。可用 `-NoAutoRepair` 关闭，`-NoAutoRepair:$false` 恢复。

**每台电脑、每个使用 Neo 的 Windows 账号安装一次即可，无需复制另一台电脑的路径。** 请传输完整源码目录，在目标电脑重新运行；不要把已部署的 `settings.json`、快捷方式或其他电脑的用户数据目录当成可同步配置。

这些措施覆盖用户快捷方式、默认链接命令和已有用户自启动入口。直接双击原始 `neo.exe`、第三方程序直接启动、更新器的私有重启流程仍可能绕过参数；登录修复也不能给已经运行的实例补参数。Windows 不保证 Run/启动文件夹的执行时机和先后顺序，所以不通过抢先自动启动 Neo 来解决竞态。若出现这种情况，完全退出 Neo，再用 **Neo（工具栏增强）** 打开即可，无需重新查路径或执行安装命令。[Chromium 启动参数说明](https://www.chromium.org/developers/how-tos/run-chromium-with-flags/)、[Windows 启动说明](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)。

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
- 如果习惯从任务栏打开 Neo，先固定到任务栏再运行脚本，以便修复对应快捷方式。更新后可用开始菜单的 **Neo（工具栏增强）** 修复入口。
- 需要 PowerShell 7.2+。用 `pwsh -v` 确认版本，没有的话用 `winget install Microsoft.PowerShell` 安装。

### 2. 获取脚本

需要整个 `neo-full-url-address-bar` 目录，包括主脚本、`NeoPaths.ps1`、`NeoPersistence.ps1`、`Invoke-NeoToolbar.ps1` 和 `zoom-controls` 扩展。不能只复制旧的一个 `.ps1`。只有缩放扩展缺失时会跳过缩放按钮。

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
2. 先预览，不写入任何改动。确认列出了任务栏快捷方式、`NeoHTM`（或 `NeoHTM.<安装 ID>`），开启了 Neo 开机启动时还有 `NeoAutoLaunch_…`：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -WhatIf
   ```

   开头会显示自动找到的 `Neo 程序` 路径。若电脑有多套 Neo，可在预览和应用时都加 `-NeoExe "实际路径\neo.exe"`。

3. 正式应用：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1
   ```

4. 从开始菜单打开 **Neo（工具栏增强）**。在地址栏打开 `chrome://version`，检查「命令行」包含 `--disable-features=...NavigatorReadOnlyOmnibox...` 和 `--load-extension=...NeoToolbarTweaks...`（选择 `-NoZoomControls` 时没有后者）。下次 Windows 登录会自动维护入口。

使用安装和使用 Neo 的同一个 Windows 账号运行即可，不需要专门用另一个管理员账号。程序安装目录和用户数据目录是两回事：如果自己使用了自定义 `--user-data-dir`，首次应用时请同时传 `-UserDataDir "实际的 User Data 根目录"`；之后会保存本机选择。

### 只要部分调整

- `-KeepVerticalTabsButton`：保留垂直选项卡按钮。
- `-NoZoomControls`：不要缩放按钮。

已经应用过的电脑加上这两个参数重新运行，就会移除对应的调整，例如：

```bash
pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -KeepVerticalTabsButton
```

### 从旧版升级

用过旧版（只有完整 URL 和全宽地址栏）的电脑，先 `git pull` 更新仓库，再按「3. 运行」重新运行一次。脚本会在原有设置上补充新的启动参数。之后仓库里的缩放扩展有更新时，也是重新运行脚本来同步。

曾经用 `-NeoExe` 处理安装路径问题的电脑，升级到此版本后完整应用一次，即会增加固定入口和登录修复。已有本机设置会在升级或撤销时重用；显式传入的参数优先。

### 撤销

```bash
pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -Undo
```

撤销会移除本工具的启动参数和偏好项，取消固定缩放按钮，删除本工具的增强入口、登录修复和部署文件；保留用户其他文件、自启动项和启动参数。会读取之前保存的本机路径，Neo 已卸载时也可清理。也可以直接运行部署后的脚本：

```powershell
pwsh -File "$env:LOCALAPPDATA\NeoToolbarTweaks\Set-NeoFullUrlAddressBar.ps1" -Undo
```

首次修改 `Preferences` 前，脚本会在同目录备份一份 `Preferences.before-neo-full-url.bak`。
可用 `-SkipPreferences`、`-SkipShortcuts`、`-SkipUrlHandlers`、`-SkipAutoStart` 跳过某一部分。`-NoAutoRepair` 只关闭登录维护，增强启动入口仍可使用。

## 常见问题

- **提示「未找到 Neo」**：新版会自动查找，不再只认 Program Files。未注册且没有快捷方式的便携版可能仍需首次用 `-NeoExe` 指定，之后会保存本机选择。指定错误路径不会静默换成另一套安装。
- **提示「未找到 zoom-controls」**：只拿到了脚本文件，按「2. 获取脚本」获取整个目录后重新运行。
- **预览里没有列出快捷方式**：任务栏图标可能是在运行脚本之后才固定的；使用 **Neo（工具栏增强）** 可重新修复，也可重新运行安装脚本。
- **增强入口无法启动或登录修复不生效**：查看 `%LOCALAPPDATA%\NeoToolbarTweaks\last-repair.log`；检查任务管理器的启动应用是否禁用了登录修复。手动入口失败会弹出错误提示。
- **缩放按钮不在工具栏上**：点工具栏的拼图图标，找到「Neo Zoom Controls」并固定一次。登录了同步账号时，脚本写入的固定状态可能被同步覆盖；在拼图菜单里手动固定由 Neo 自己写入账号层，会随同步保存。
- **重启电脑后又只显示域名，地址栏或缩放按钮不见了**：多半是 Neo 的开机启动项不带参数，抢先启动了 Neo。旧版脚本不处理这一项，按「从旧版升级」完整应用一次即可；之后每次登录都会自动修复。确认方法：在地址栏打开 `chrome://version`，看「命令行」里有没有 `--disable-features=...NavigatorReadOnlyOmnibox...`。
- **运行后仍然只显示域名，或左侧按钮还在**：先完全退出 Neo，再从任务栏或开始菜单打开。如果还是不行，在地址栏打开 `chrome://settings/help` 查看 Neo 版本：两个特性名只在 154.0.8603.100 上确认过。

## 注意

- 「所有用户」快捷方式和 HKLM 自启动命令只检查、不新增本用户配置，避免把当前账号的扩展路径写入其他账号的入口。使用本用户的 **Neo（工具栏增强）**。长度会超过 Windows Run 260 字符限制的自启动命令也会保留并提示。
- 启动参数只在 Neo 冷启动时生效。如果 Neo 被其他途径启动（例如更新后自动重启），三项调整都会暂时消失，完全退出后从任务栏重新打开即可恢复，缩放按钮的固定位置也会保留。
- Neo 更新可能重建入口；下次登录或打开 **Neo（工具栏增强）** 时会重新修复。升级工具自身源码后仍需完整应用一次，以更新部署副本。
- 关闭只读地址栏后，地址栏变为可直接编辑的标准地址栏，点击和输入时的交互可能与原来不同（这部分未逐项验证）。
- 移除垂直选项卡按钮后，就无法再切换到垂直选项卡。智能分组不受影响，可以在 Neo Preferences 里开关。
- 特性名 `NavigatorReadOnlyOmnibox` 和 `NeoVerticalTabs` 都基于 Neo 154.0.8603.100 实测确认。如果 Neo 以后改名或移除了它们，需要重新确认。

## 回归验证

测试使用临时目录和模拟系统接口，不启动/关闭真实 Neo，不改真实配置、注册表或快捷方式：

```powershell
pwsh -NoProfile -File neo-full-url-address-bar/tests/Run-RegressionTests.ps1
pwsh -NoProfile -File neo-full-url-address-bar/tests/Run-PathDiscoveryTests.ps1
pwsh -NoProfile -File neo-full-url-address-bar/tests/Run-RuntimeTests.ps1
```
