# 汉堡回车键

任何能发出一个按键或打开一个网址的硬件，都能变成麦当劳键。交互统一为：**按一下试算，60 秒内再按一下下单，自动打开付款页**。

## 1. 先让按键发出 F13

| 硬件 | 做法 |
| --- | --- |
| QMK / VIA 键盘、小键盘 | 在 VIA 里把某个键改成 `F13` |
| 罗技 / 雷蛇宏键 | 在官方驱动里把宏设为按下 `F13` |
| 汉堡回车键玩具 | 本质是一个 USB 回车键：在终端里配合 `mcd`，回车就是确认下单 |

## 2. 接到服务

- Windows：安装 [AutoHotkey v2](https://www.autohotkey.com/)，双击 `mcaction.ahk`。
- macOS：安装 [Hammerspoon](https://www.hammerspoon.org/)，把 `hammerspoon-init.lua` 追加到 `~/.hammerspoon/init.lua`。

## 3. Stream Deck

不需要任何脚本。添加「系统 → 网站」动作，网址填：

```text
http://127.0.0.1:3790/v1/press?format=html&scene=auto&key=你的MCACTION_KEY
```

按第一次浏览器显示试算结果，再按一次跳转到付款二维码。每个场景（home / work / car）可以各放一个按键。
