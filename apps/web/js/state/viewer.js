/**
 * M9-02：当前客户端的「视角座位」。
 *
 * 单机模式人类固定 0 号位，此前 UI/动效层多处硬编码 seat === 0 表示「我」；
 * 联机模式座位由服务端分配（可以是任意座位），因此集中在这里维护：
 * 每次渲染游戏画面时由 ui/players.js 用 view.human.seat 更新，
 * 动效（飞牌落点/正面朝上）、音效（胜/负）、挑战提示统一从这里读取。
 */
let viewerSeat = 0;

export function setViewerSeat(seat) {
  viewerSeat = Number.isInteger(seat) && seat >= 0 ? seat : 0;
}

export function getViewerSeat() {
  return viewerSeat;
}
