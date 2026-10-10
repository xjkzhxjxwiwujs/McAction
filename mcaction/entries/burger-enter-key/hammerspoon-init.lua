-- 汉堡回车键（macOS）：追加到 ~/.hammerspoon/init.lua，把宏键映射成 F13。
-- Hammerspoon 读不到 shell 环境变量，服务开了鉴权就把 key 填在这里。
local server = "http://127.0.0.1:3790"
local key = ""

local function press(scene)
  hs.alert.show("麦一下：正在试算…")
  hs.http.asyncPost(server .. "/v1/press?format=text&scene=" .. scene, "", { ["x-mcaction-key"] = key },
    function(status, body)
      if status ~= 200 then
        hs.alert.show("麦一下出错：" .. tostring(body or status))
        return
      end
      local pay = body:match("PAY (%S+)")
      if pay then hs.urlevent.openURL(pay) end
      hs.notify.new({ title = "麦一下", informativeText = (body:gsub("\nPAY %S+", "")) }):send()
    end)
end

hs.hotkey.bind({}, "f13", function() press("auto") end)
hs.hotkey.bind({ "ctrl", "alt" }, "m", function() press("auto") end)
