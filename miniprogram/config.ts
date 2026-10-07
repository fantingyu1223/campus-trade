/**
 * config.ts —— 小程序全局配置单点。
 *
 * 切换环境只需改这一处 API_BASE：
 *  - 微信开发者工具模拟器：可用 http://localhost:3000/api/v1
 *  - 真机预览/体验：改成本机局域网 IP（手机与电脑同一 WiFi），
 *    如 http://192.168.0.100:3000/api/v1
 *  - 生产（域名备案+小程序主体就绪后）：https://api.<个人域名占位>/api/v1
 *
 * 开发期请在开发者工具「详情 → 本地设置」勾选「不校验合法域名…」。
 * 图片占位：COS 未开通前，图片 URL 可用后端本地静态目录
 *   http://<host>:3000/static/placeholder.png
 */
export const API_BASE = 'http://192.168.0.100:3000/api/v1';
