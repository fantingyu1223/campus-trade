/**
 * risk-scan.cron.ts —— 黄牛预警每日扫描（T-304）
 *
 * 规则：
 *  ① daily_ge5          当日发布 ≥ 5 件（非 merchant）
 *  ② cross_ge3_cat      在售商品跨 ≥ 3 个类目（非 merchant）
 *  ③ suspected_merchant 近 30 天被拦截 ≥ 3 次 或 当日发布 ≥ 10 件（非 merchant）
 *
 * 自含调度：env RISK_SCAN_CRON_ENABLED==='1' 时 start() 生效，24h 一轮。
 *
 * @module PIM-BC-05
 * @rule CIM-R-36
 */
import { Injectable, Logger } from '@nestjs/common';
import { RiskWarningRepository, RiskRuleCode } from './risk-warning.repository';

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class RiskScanCron {
  private readonly logger = new Logger(RiskScanCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly repo: RiskWarningRepository) {}

  start(): void {
    if (process.env.RISK_SCAN_CRON_ENABLED !== '1') return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runDaily().catch((e) => this.logger.error(`risk scan failed: ${e}`));
    }, DAY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 执行一轮扫描，返回新建预警条数 */
  async runDaily(now: Date = new Date()): Promise<number> {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);

    const [dailyGroups, catRows, blockedGroups] = await Promise.all([
      this.repo.countDailyPublished(dayStart, now),
      this.repo.listOnSaleSellerCategory(),
      this.repo.countBlockedSince(since30d),
    ]);

    const dailyMap = new Map<string, number>();
    for (const g of dailyGroups) dailyMap.set(String(g.seller_id), g._count._all);

    const catMap = new Map<string, Set<string>>();
    for (const r of catRows) {
      const k = String(r.seller_id);
      if (!catMap.has(k)) catMap.set(k, new Set());
      catMap.get(k)!.add(String(r.category_id));
    }

    const blockedMap = new Map<string, number>();
    for (const g of blockedGroups) blockedMap.set(String(g.user_id), g._count._all);

    // 汇总候选用户，一次查身份，排除 merchant
    const candidateIds = new Set<string>();
    for (const [id, n] of dailyMap) if (n >= 5) candidateIds.add(id);
    for (const [id, s] of catMap) if (s.size >= 3) candidateIds.add(id);
    for (const [id, n] of blockedMap) if (n >= 3) candidateIds.add(id);

    const identities = await this.repo.findUserIdentities(
      [...candidateIds].map((s) => BigInt(s)),
    );
    const identityMap = new Map(identities.map((u) => [String(u.id), u.identity_type]));
    const isMerchant = (id: string) => identityMap.get(id) === 'merchant';

    let created = 0;
    const tryCreate = async (
      idStr: string,
      ruleCode: RiskRuleCode,
      snapshot: Record<string, unknown>,
    ) => {
      const userId = BigInt(idStr);
      if (await this.repo.existsPending(userId, ruleCode)) return; // 幂等：已有 pending 不重复
      await this.repo.createWarning({
        user_id: userId,
        rule_code: ruleCode,
        rule_snapshot: snapshot,
      });
      created += 1;
    };

    // ① daily_ge5：日发 ≥ 5
    for (const [id, n] of dailyMap) {
      if (n >= 5 && !isMerchant(id)) {
        await tryCreate(id, 'daily_ge5', { daily_count: n });
      }
    }

    // ② cross_ge3_cat：在售跨类目 ≥ 3
    for (const [id, s] of catMap) {
      if (s.size >= 3 && !isMerchant(id)) {
        await tryCreate(id, 'cross_ge3_cat', { category_count: s.size });
      }
    }

    // ③ suspected_merchant：30d 拦截 ≥ 3 或 日发 ≥ 10
    const suspectedIds = new Set<string>();
    for (const [id, n] of blockedMap) if (n >= 3) suspectedIds.add(id);
    for (const [id, n] of dailyMap) if (n >= 10) suspectedIds.add(id);
    for (const id of suspectedIds) {
      if (isMerchant(id)) continue;
      await tryCreate(id, 'suspected_merchant', {
        blocked_30d: blockedMap.get(id) ?? 0,
        daily_count: dailyMap.get(id) ?? 0,
      });
    }

    return created;
  }
}
