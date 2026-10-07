/**
 * 小程序全局定时器声明补充（miniprogram-api-typings 未声明 setTimeout/setInterval）。
 * 与微信开发者工具运行时行为一致。
 */
declare function setTimeout(handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): number;
declare function clearTimeout(timeoutID: number): void;
declare function setInterval(handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): number;
declare function clearInterval(intervalID: number): void;
