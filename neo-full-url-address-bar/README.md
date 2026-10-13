# Neo 地址栏：始终显示完整 URL + 占满宽度

Norton Neo 的地址栏默认只显示域名（如 `aistudio.google.com`），且两侧留有大片空白。
`Set-NeoFullUrlAddressBar.ps1` 让地址栏始终显示完整 URL（含 `https://`、路径、查询参数和 `#` 片段），并拉伸到工具栏全宽。

## 为什么不是 Tampermonkey 脚本

Neo 的地址栏是浏览器自身界面（`chrome://` 顶层 WebUI 里的 `<readonly-omnibox>` 组件），不属于任何网页。
Tampermonkey 等扩展被浏览器禁止注入这类界面，用户脚本改不到它，只能通过浏览器级配置实现。

## 原理

| 改动 | 作用 |
| --- | --- |
| 启动参数 `--disable-features=NavigatorReadOnlyOmnibox` | 关闭 Neo 的「只读地址栏」，换回标准 Chromium 地址栏，不再只显示域名 |
| 偏好 `omnibox.prevent_url_elisions = true` | 始终显示完整 URL（等同 Chrome 地址栏右键「始终显示完整网址」） |
| 偏好 `navigator.omnibox.use_full_width = true` | 地址栏占满宽度（等同 Neo Preferences 里的「Use full address bar width」） |
| 偏好 `navigator.omnibox.show_title = false` | 不用页面标题替代 URL |

启动参数会写入这些位置：

- 指向 `neo.exe` 的快捷方式：任务栏固定、开始菜单、桌面
- Neo 作为默认浏览器时打开链接的命令：在 `HKCU\Software\Classes\NeoHTM`、`NeoPDF` 下新建用户级覆盖项，不改动 HKLM，也不需要管理员权限

## 使用

需要 PowerShell 7.2+（`pwsh`）。

1. 完全退出 Neo（包括后台进程），否则 Neo 退出时会覆盖偏好改动。脚本检测到 Neo 仍在运行时会拒绝执行。
2. 先预览，不写入任何改动：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -WhatIf
   ```

3. 正式应用，然后从任务栏或开始菜单重新打开 Neo：

   ```bash
   pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1
   ```

撤销全部改动：

```bash
pwsh -File neo-full-url-address-bar/Set-NeoFullUrlAddressBar.ps1 -Undo
```

首次修改 `Preferences` 前，会在同目录备份一份 `Preferences.before-neo-full-url.bak`。
可用 `-SkipPreferences`、`-SkipShortcuts`、`-SkipUrlHandlers` 跳过某一部分。

## 注意

- 开始菜单里的「所有用户」快捷方式（`C:\ProgramData\...\Neo.lnk`）需要管理员权限才能修改；普通权限下运行会跳过它并给出提示。
- 参数只在 Neo 冷启动时生效。如果 Neo 被其他途径启动（例如更新后自动重启），地址栏会恢复为只显示域名，完全退出后从任务栏重新打开即可。
- Neo 更新可能重建快捷方式或默认浏览器注册项，届时重新运行脚本即可，重复运行不会重复写入。
- 关闭只读地址栏后，地址栏变为可直接编辑的标准地址栏，点击和输入时的交互可能与原来不同（这部分未逐项验证）。
- 特性名 `NavigatorReadOnlyOmnibox` 基于 Neo 154.0.8603.100 实测确认。如果 Neo 以后改名或移除这个特性，需要重新确认。
