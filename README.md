# Koi Club 刮刮乐 Netlify 免费部署版

这是 Netlify 免绑卡部署版，用 Netlify Functions + Netlify Blobs 保存后台数据。

## Netlify 部署参数

Build command:
npm install

Publish directory:
public

Functions directory:
netlify/functions

客户页面:
https://你的站点.netlify.app/

后台:
https://你的站点.netlify.app/admin


## v2 更新

- 修复后台生成兑换码时报错：`The environment has not been configured to use Netlify Blobs`
- 原因是 Netlify Functions 的 Lambda 兼容模式需要手动连接 Blobs 环境。
- 已在函数入口加入 `connectLambda(event)`。


## v3 更新
- 奖池宣传页替换为新版「幸运奖池」整图。
- 刮出大剑时使用新版粉色「大剑」奖励素材。
- 实际刮奖只会触发大剑，不会触发瓦当、吞金兽、圣杯、神龙。
- 后台权重只保留 18.8 档大剑权重、28.8 档大剑权重。
- 大金奖励弹窗不再显示 0W，改为显示「本局触发大金奖励」和「大金奖励：大剑」。


v4更新

- 奖池图替换为最新版本（含龙舟送吉 / 大剑 / 圣杯 / 神龙宣传位）
- 刮出大金时支持：大剑、龙舟送吉
- 18.8 档、28.8 档后台均可分别设置大剑 / 龙舟送吉权重
- 刮出大金时前端显示“本局触发大金奖励”，不再显示 0W
