# RingCentral 快捷文本贴纸 GIF

五个带文字的小尺寸动画贴纸：`on it`、`working`、`checking`、`thank you`、`love it`。
RingCentral 的 reaction 只支持标准 emoji，所以这些 GIF 用来在消息里（建议在线程里）回复，所有同事、所有客户端都能看到。

| 文件 | 内容 |
| --- | --- |
| `gifs/onit.gif` | 黄色小团子敬礼 + on it |
| `gifs/working.gif` | 橘猫敲笔记本 + working |
| `gifs/checking.gif` | 薄荷色小团子拿放大镜 + checking |
| `gifs/thankyou.gif` | 紫色小团子双手合十鞠躬 + thank you |
| `gifs/loveit.gif` | 爱心角色心跳 + love it |

规格：160×160 px、透明背景（白色描边贴纸边）、无限循环，每个 100 KB 以内。打开 `gallery.html` 可在浅色 / 深色背景下预览。

## 在 RingCentral 里使用

在消息上点「回复」进入线程，把 GIF 拖进输入框（或用附件按钮上传）后发送。
注意：公司管理员如果关闭了文件上传，这种方式不可用。

## 重新生成

需要 Node.js、Google Chrome（或 Edge）和 ffmpeg。

```bash
cd gif-src
node build.mjs                  # 生成全部 GIF 到 ../gifs
node build.mjs --preview onit   # 只生成 onit，并输出 ../preview/onit.png 审阅图
```

每个贴纸是 `gif-src/stickers/<id>.js` 里的一段 SVG 动画（吉祥物 + 文字）。`lib.js` 负责文字描边和贴纸白边，`build.mjs` 用无头浏览器截取逐帧精灵图，再用 ffmpeg 生成 64 色 GIF。改文字只需修改对应文件的 `label`。
