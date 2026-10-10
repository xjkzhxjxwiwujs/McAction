#Requires AutoHotkey v2.0
#SingleInstance Force
; 汉堡回车键（Windows）：把键盘宏 / 小键盘 / 汉堡键映射成 F13。
; 按一下：按当前场景试算并弹通知；60 秒内再按一下：下单并打开付款页。

Server := "http://127.0.0.1:3790"
Key := EnvGet("MCACTION_KEY")

F13::Press("auto")
^!m::Press("auto")      ; 没有宏键时用 Ctrl+Alt+M

Press(scene) {
    global Server, Key
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("POST", Server "/v1/press?format=text&scene=" scene, false)
    req.SetRequestHeader("x-mcaction-key", Key)
    req.SetTimeouts(5000, 5000, 30000, 60000)
    TrayTip("正在试算…", "麦一下")
    try req.Send()
    catch as e {
        TrayTip("连不上麦一下服务，请先 npm start`n" e.Message, "麦一下")
        return
    }
    text := Utf8Body(req)
    if RegExMatch(text, "m)^PAY (\S+)$", &m) {
        Run(m[1])
        text := RegExReplace(text, "m)^PAY .*$")
    }
    TrayTip(Trim(text, " `r`n"), "麦一下")
}

Utf8Body(req) {
    stream := ComObject("ADODB.Stream")
    stream.Type := 1
    stream.Open()
    stream.Write(req.ResponseBody)
    stream.Position := 0
    stream.Type := 2
    stream.Charset := "utf-8"
    text := stream.ReadText()
    stream.Close()
    return text
}
