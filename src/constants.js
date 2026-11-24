// dsh-pstack-deck · 时间与上限
//
// 为什么单独一个文件：这些数字以前散在五个模块里，面板显示「5 秒」而宿主缓存
// 写的是 5000，改一处忘一处就是「明明点了刷新还是旧的」。现在只有一个出处。

/** 面板一次读的复用窗口：5 秒内重复读不再碰盘。 */
export const SNAPSHOT_TTL_MS = 5_000

/** 在办表窗口：24 小时内算「在办」，超过的降为「存档」，7 天前的直接不读。 */
export const WORK_WINDOW_MS = 24 * 60 * 60 * 1000
export const WORK_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000

/** 一条 git 命令的最长等待：够慢的仓也够快，卡住就归因成 network。 */
export const GIT_TIMEOUT_MS = 8_000

/** 提交票有效期：两分钟，够人看清改动再点。 */
export const TICKET_TTL_MS = 120_000