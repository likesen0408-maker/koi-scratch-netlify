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
