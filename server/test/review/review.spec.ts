/**
 * review.spec.ts —— T-209 交易评价模块（提交评价 / 公开列表 / 默认好评 cron）
 *
 * @module PIM-BC-05 交易评价
 * @rule F17 7 天评价窗口、延迟公开（双方互评后立即公开）、超时默认好评
 * @decision PIM-D-2：评价窗口不顺延——无论订单是否曾申诉冻结，
 *   review_deadline 恒等于 completed_at + 7 天
 * @api §5.2 #38 POST /reviews、#39 GET /users/{id}/reviews
 *
 * 覆盖验收点：
 *  - 提交：单方提交不公开（published_at=null）/ 双方提交立即公开
 *  - 守卫：订单不存在 5001 / 非 completed 5001 / completed_at 为 null 5001 /
 *    超窗 5001 / 非买卖双方 1003 / 重复提交 5002
 *  - 窗口不顺延：review_deadline 恒等 completed_at+7d（PIM-D-2）
 *  - 列表：仅 is_public=true + reviewer_role 按订单 buyer_id 判定 + 订单缺失跳过该条 + 分页 skip/take（上限 50）
 *  - cron 逻辑：单方已评补对方 / 双方未评补两条 / 均已公开跳过 / completed_at null 跳过 /
 *    双方已提交未公开只公开不补录 / deadline>now 防御跳过
 *  - cron 调度：start/stop/24h interval/env REVIEW_DEFAULT_CRON_ENABLED==='1' 分支
 *  - controller：POST /reviews 三例（成功 / 未登录 1001）+ GET 游客可读 + id 非法 9001
 *  - validator：order_id 必填 / rating 1-5 整数（score 别名）/ content ≤500 空串 9001
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（tradeOrder/review 两表）。
 */
import { ERROR_CODES } from '@contract/index';
import { BusinessError, ReviewService } from '../../src/modules/review/review.service';
import { ReviewRepository } from '../../src/modules/review/review.repository';
import { ReviewController } from '../../src/modules/review/review.controller';
import { ReviewDefaultCron } from '../../src/modules/review/review-default.cron';
import { validateSubmitReview } from '../../src/modules/review/review.validator';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER_ID = BigInt(2);
const SELLER_ID = BigInt(1);
const ORDER_ID = BigInt(9001);
const REVIEW_ID = BigInt(5001);
const COMPLETED_AT = new Date('2026-10-01T08:00:00.000Z');
const DEADLINE = new Date('2026-10-08T08:00:00.000Z'); // completed_at + 7d，恒等不顺延
const NOW = new Date('2026-10-06T08:00:00.000Z'); // 窗口内

const makeOrderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  order_no: 'ES20261001ABC123',
  product_id: BigInt(100),
  product_title: '高等数学（下册）',
  buyer_id: BUYER_ID,
  seller_id: SELLER_ID,
  status: 'completed',
  completed_at: COMPLETED_AT,
  created_at: COMPLETED_AT,
  updated_at: COMPLETED_AT,
  ...over,
});

const makeReviewRow = (over: Record<string, unknown> = {}) => ({
  id: REVIEW_ID,
  order_id: ORDER_ID,
  reviewer_id: BUYER_ID,
  reviewee_id: SELLER_ID,
  rating: 5,
  content: '交易愉快',
  is_default: false,
  is_public: false,
  review_deadline: DEADLINE,
  public_at: null,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

const makePrismaMock = () =>
  ({
    tradeOrder: { findUnique: jest.fn(), findMany: jest.fn() },
    review: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  }) as unknown as PrismaService & {
    tradeOrder: { findUnique: jest.Mock; findMany: jest.Mock };
    review: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new ReviewRepository(prisma);
  const service = new ReviewService(repo);
  return { prisma, repo, service };
};

const expectBizError = async (p: Promise<unknown>, code: number) => {
  await expect(p).rejects.toMatchObject({ code });
  await p.catch((e: BusinessError) => expect(e).toBeInstanceOf(BusinessError));
};

const expectValidatorError = (raw: unknown, code: number) => {
  try {
    validateSubmitReview(raw);
    throw new Error('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessError);
    expect((e as BusinessError).code).toBe(code);
  }
};

/** 提交评价成功路径 mock：completed 订单 + 无重复 + 对方未评 */
const mockSubmitFirstSide = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
  prisma.review.findFirst.mockResolvedValue(null);
  prisma.review.create.mockResolvedValue(makeReviewRow());
};

// ---------- validator ----------

describe('validateSubmitReview（9001 聚合式拦截）', () => {
  it('order_id 缺失 → 9001', () => {
    expectValidatorError({ rating: 5 }, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
  it('order_id 非法 → 9001', () => {
    expectValidatorError({ order_id: 'abc', rating: 5 }, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
  it('rating 缺失 → 9001', () => {
    expectValidatorError({ order_id: '9001' }, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
  it.each([0, 6, 3.5, -1, '5'])('rating=%j 非 1-5 整数 → 9001', (rating) => {
    expectValidatorError({ order_id: '9001', rating }, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
  it('score 别名兼容：{ score: 4 } → rating=4', () => {
    const input = validateSubmitReview({ order_id: '9001', score: 4 });
    expect(input.orderId).toBe(ORDER_ID);
    expect(input.rating).toBe(4);
    expect(input.content).toBeNull();
  });
  it('rating 优先于 score', () => {
    const input = validateSubmitReview({ order_id: '9001', rating: 2, score: 4 });
    expect(input.rating).toBe(2);
  });
  it('content 超过 500 字 → 9001', () => {
    expectValidatorError(
      { order_id: '9001', rating: 5, content: 'x'.repeat(501) },
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
  });
  it('content 空串 → 9001', () => {
    expectValidatorError({ order_id: '9001', rating: 5, content: '' }, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
  it('content 缺省 → null（合法）', () => {
    const input = validateSubmitReview({ order_id: '9001', rating: 5 });
    expect(input.content).toBeNull();
  });
});

// ---------- submitReview ----------

describe('ReviewService.submitReview（§5.2 #38 POST /reviews）', () => {
  it('提交成功（单方）：is_public=false 落库，published_at=null', async () => {
    const { prisma, service } = setup();
    mockSubmitFirstSide(prisma);

    const result = await service.submitReview(
      BUYER_ID,
      { order_id: '9001', rating: 5, content: '交易愉快' },
      NOW,
    );

    expect(result.review_id).toBe(REVIEW_ID.toString());
    expect(result.published_at).toBeNull();
    expect(prisma.review.create).toHaveBeenCalledTimes(1);
    const createData = prisma.review.create.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      order_id: ORDER_ID,
      reviewer_id: BUYER_ID,
      reviewee_id: SELLER_ID,
      rating: 5,
      content: '交易愉快',
      is_default: false,
      is_public: false,
    });
    // PIM-D-2 裁决：无论订单是否曾申诉冻结，deadline 恒等 completed_at + 7d，窗口不顺延
    expect(createData.review_deadline).toEqual(DEADLINE);
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('提交成功（双方）：对方已评 → 立即公开，published_at=now', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    prisma.review.findFirst
      .mockResolvedValueOnce(null) // 重复校验：本人未评
      .mockResolvedValueOnce(makeReviewRow({ reviewer_id: SELLER_ID, reviewee_id: BUYER_ID })); // 对方已评
    prisma.review.create.mockResolvedValue(makeReviewRow({ reviewer_id: SELLER_ID, reviewee_id: BUYER_ID }));
    prisma.review.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.submitReview(SELLER_ID, { order_id: '9001', score: 4 }, NOW);

    expect(result.published_at).toBe(NOW.toISOString());
    expect(prisma.review.updateMany).toHaveBeenCalledWith({
      where: { order_id: ORDER_ID },
      data: { is_public: true, public_at: NOW },
    });
  });

  it('订单不存在 → 5001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(
      service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, NOW),
      ERROR_CODES.ORDER_NOT_REVIEWABLE,
    );
  });

  it('订单非 completed → 5001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm', completed_at: null }));
    await expectBizError(
      service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, NOW),
      ERROR_CODES.ORDER_NOT_REVIEWABLE,
    );
  });

  it('completed 但 completed_at 为 null → 5001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ completed_at: null }));
    await expectBizError(
      service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, NOW),
      ERROR_CODES.ORDER_NOT_REVIEWABLE,
    );
  });

  it('超出 7 天窗口（now > completed_at+7d）→ 5001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    const afterDeadline = new Date(DEADLINE.getTime() + 1);
    await expectBizError(
      service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, afterDeadline),
      ERROR_CODES.ORDER_NOT_REVIEWABLE,
    );
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('窗口边界 now === deadline 仍允许提交', async () => {
    const { prisma, service } = setup();
    mockSubmitFirstSide(prisma);
    const result = await service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, DEADLINE);
    expect(result.review_id).toBe(REVIEW_ID.toString());
  });

  it('非买卖双方 → 1003', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    await expectBizError(
      service.submitReview(BigInt(999), { order_id: '9001', rating: 5 }, NOW),
      ERROR_CODES.PERMISSION_DENIED,
    );
  });

  it('重复提交（同订单同人）→ 5002', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    prisma.review.findFirst.mockResolvedValue(makeReviewRow());
    await expectBizError(
      service.submitReview(BUYER_ID, { order_id: '9001', rating: 5 }, NOW),
      ERROR_CODES.DUPLICATE_REVIEW,
    );
    expect(prisma.review.create).not.toHaveBeenCalled();
  });
});

// ---------- listPublicReviews ----------

describe('ReviewService.listPublicReviews（§5.2 #39 GET /users/{id}/reviews）', () => {
  it('仅返回 is_public=true，reviewer_role 按订单 buyer_id 判定，订单缺失跳过该条', async () => {
    const { prisma, service } = setup();
    const otherOrderId = BigInt(9002);
    prisma.review.findMany.mockResolvedValue([
      makeReviewRow({ is_public: true, public_at: NOW, reviewer_id: BUYER_ID }),
      makeReviewRow({ id: BigInt(5002), order_id: otherOrderId, is_public: true, reviewer_id: BigInt(3) }),
    ]);
    prisma.review.count.mockResolvedValue(2);
    // 仅返回第一单的订单（第二单订单缺失 → 跳过该条）
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);

    const result = await service.listPublicReviews(SELLER_ID, {});

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reviewee_id: SELLER_ID, is_public: true },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      review_id: REVIEW_ID.toString(),
      score: 5,
      content: '交易愉快',
      reviewer_role: 'buyer', // reviewer_id === order.buyer_id
    });
  });

  it('评价人是卖家时 reviewer_role=seller', async () => {
    const { prisma, service } = setup();
    prisma.review.findMany.mockResolvedValue([
      makeReviewRow({ is_public: true, reviewer_id: SELLER_ID, reviewee_id: BUYER_ID }),
    ]);
    prisma.review.count.mockResolvedValue(1);
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);

    const result = await service.listPublicReviews(BUYER_ID, {});
    expect(result.list[0].reviewer_role).toBe('seller');
  });

  it('分页：默认 page=1/pageSize=20 → skip=0/take=20', async () => {
    const { prisma, service } = setup();
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);
    await service.listPublicReviews(SELLER_ID, {});
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });

  it('分页：page=3&pageSize=10 → skip=20/take=10（字符串参数兼容）', async () => {
    const { prisma, service } = setup();
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);
    const result = await service.listPublicReviews(SELLER_ID, { page: '3', pageSize: '10' });
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(result.page).toBe(3);
    expect(result.page_size).toBe(10);
  });

  it('分页：pageSize 上限 50', async () => {
    const { prisma, service } = setup();
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);
    await service.listPublicReviews(SELLER_ID, { page: 1, pageSize: 100 });
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});

// ---------- applyDefaultReviews（cron 逻辑） ----------

describe('ReviewService.applyDefaultReviews（F17 超时默认好评）', () => {
  const AFTER_WINDOW = new Date('2026-10-09T08:00:00.000Z'); // > completed_at+7d

  it('单方已评：为缺评方补一条 is_default/rating=5/content=null，统一公开，返回 1', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);
    prisma.review.findMany.mockResolvedValue([makeReviewRow({ reviewer_id: BUYER_ID })]);
    prisma.review.create.mockResolvedValue(makeReviewRow({ reviewer_id: SELLER_ID, is_default: true, content: null }));
    prisma.review.updateMany.mockResolvedValue({ count: 2 });

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(1);
    expect(prisma.review.create).toHaveBeenCalledTimes(1);
    expect(prisma.review.create.mock.calls[0][0].data).toMatchObject({
      order_id: ORDER_ID,
      reviewer_id: SELLER_ID,
      reviewee_id: BUYER_ID,
      rating: 5,
      content: null,
      is_default: true,
      review_deadline: DEADLINE, // PIM-D-2：恒等 completed_at+7d
    });
    expect(prisma.review.updateMany).toHaveBeenCalledWith({
      where: { order_id: ORDER_ID },
      data: { is_public: true, public_at: AFTER_WINDOW },
    });
  });

  it('双方均未评：补两条，返回 2', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.create.mockResolvedValue(makeReviewRow({ is_default: true, content: null }));
    prisma.review.updateMany.mockResolvedValue({ count: 2 });

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(2);
    expect(prisma.review.create).toHaveBeenCalledTimes(2);
    expect(prisma.review.updateMany).toHaveBeenCalledTimes(1);
  });

  it('双方均已公开：跳过（不补录不公开），返回 0', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);
    prisma.review.findMany.mockResolvedValue([
      makeReviewRow({ reviewer_id: BUYER_ID, is_public: true }),
      makeReviewRow({ id: BigInt(5002), reviewer_id: SELLER_ID, is_public: true }),
    ]);

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(0);
    expect(prisma.review.create).not.toHaveBeenCalled();
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('双方已提交但未公开：只公开不补录，返回 0', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow()]);
    prisma.review.findMany.mockResolvedValue([
      makeReviewRow({ reviewer_id: BUYER_ID, is_public: false }),
      makeReviewRow({ id: BigInt(5002), reviewer_id: SELLER_ID, is_public: false }),
    ]);
    prisma.review.updateMany.mockResolvedValue({ count: 2 });

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(0);
    expect(prisma.review.create).not.toHaveBeenCalled();
    expect(prisma.review.updateMany).toHaveBeenCalledTimes(1);
  });

  it('completed_at 为 null：跳过该单', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow({ completed_at: null })]);

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(0);
    expect(prisma.review.findMany).not.toHaveBeenCalled();
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('防御：deadline > now 的单据跳过（repository 口径之外的脏数据）', async () => {
    const { prisma, service } = setup();
    const recent = new Date(AFTER_WINDOW.getTime() - 3 * 24 * 3600 * 1000); // completed 仅 3 天前
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrderRow({ completed_at: recent })]);

    const created = await service.applyDefaultReviews(AFTER_WINDOW);

    expect(created).toBe(0);
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('扫描口径：completed 且 completed_at ≤ now-7d', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findMany.mockResolvedValue([]);
    const created = await service.applyDefaultReviews(AFTER_WINDOW);
    expect(created).toBe(0);
    const where = prisma.tradeOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('completed');
    expect(where.completed_at.lte).toEqual(new Date(AFTER_WINDOW.getTime() - 7 * 24 * 3600 * 1000));
  });
});

// ---------- ReviewDefaultCron 调度 ----------

describe('ReviewDefaultCron（24h 调度，env 开关）', () => {
  const makeCron = () => {
    const reviewService = { applyDefaultReviews: jest.fn().mockResolvedValue(0) };
    const cron = new ReviewDefaultCron(reviewService as unknown as ReviewService);
    return { cron, reviewService };
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    delete process.env.REVIEW_DEFAULT_CRON_ENABLED;
    jest.useRealTimers();
  });

  it('start 后每 24h 触发一次 applyDefaultReviews，stop 后不再触发', async () => {
    const { cron, reviewService } = makeCron();
    cron.start();
    expect(cron.isRunning()).toBe(true);

    await jest.advanceTimersByTimeAsync(24 * 3600 * 1000);
    expect(reviewService.applyDefaultReviews).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(24 * 3600 * 1000);
    expect(reviewService.applyDefaultReviews).toHaveBeenCalledTimes(2);

    cron.stop();
    expect(cron.isRunning()).toBe(false);
    await jest.advanceTimersByTimeAsync(48 * 3600 * 1000);
    expect(reviewService.applyDefaultReviews).toHaveBeenCalledTimes(2);
  });

  it('重复 start 幂等（不叠加定时器）', async () => {
    const { cron, reviewService } = makeCron();
    cron.start();
    cron.start();
    await jest.advanceTimersByTimeAsync(24 * 3600 * 1000);
    expect(reviewService.applyDefaultReviews).toHaveBeenCalledTimes(1);
    cron.stop();
  });

  it('onModuleInit：REVIEW_DEFAULT_CRON_ENABLED===\'1\' 时自动启动', () => {
    const { cron } = makeCron();
    process.env.REVIEW_DEFAULT_CRON_ENABLED = '1';
    cron.onModuleInit();
    expect(cron.isRunning()).toBe(true);
    cron.stop();
  });

  it('onModuleInit：env 未开启时不启动', () => {
    const { cron } = makeCron();
    process.env.REVIEW_DEFAULT_CRON_ENABLED = '0';
    cron.onModuleInit();
    expect(cron.isRunning()).toBe(false);
  });

  it('applyDefaultReviews 异常被吞掉，不影响后续轮次', async () => {
    const { cron, reviewService } = makeCron();
    reviewService.applyDefaultReviews.mockRejectedValueOnce(new Error('db down'));
    cron.start();
    await jest.advanceTimersByTimeAsync(24 * 3600 * 1000);
    await jest.advanceTimersByTimeAsync(24 * 3600 * 1000);
    expect(reviewService.applyDefaultReviews).toHaveBeenCalledTimes(2);
    cron.stop();
  });
});

// ---------- ReviewController ----------

describe('ReviewController（§5.2 #38/#39，统一响应包络 §5.1）', () => {
  const setupController = () => {
    const reviewService = {
      submitReview: jest.fn(),
      listPublicReviews: jest.fn(),
    };
    const controller = new ReviewController(reviewService as unknown as ReviewService);
    return { controller, reviewService };
  };

  it('POST /reviews 成功：uid 转 BigInt 透传，返回 code=0 包络', async () => {
    const { controller, reviewService } = setupController();
    reviewService.submitReview.mockResolvedValue({ review_id: '5001', published_at: null });
    const res = await controller.submit(
      { order_id: '9001', rating: 5 },
      { user: { uid: '2' } },
    );
    expect(res.code).toBe(0);
    expect(res.data).toEqual({ review_id: '5001', published_at: null });
    expect(reviewService.submitReview).toHaveBeenCalledWith(BUYER_ID, { order_id: '9001', rating: 5 });
  });

  it('POST /reviews：req.user.uid??id 均缺失 → 1001', async () => {
    const { controller, reviewService } = setupController();
    await expectBizError(controller.submit({ order_id: '9001', rating: 5 }, {}), ERROR_CODES.AUTH_TOKEN_INVALID);
    expect(reviewService.submitReview).not.toHaveBeenCalled();
  });

  it('POST /reviews：uid 缺失时回退 id 字段', async () => {
    const { controller, reviewService } = setupController();
    reviewService.submitReview.mockResolvedValue({ review_id: '5001', published_at: null });
    await controller.submit({ order_id: '9001', rating: 5 }, { user: { id: '2' } });
    expect(reviewService.submitReview).toHaveBeenCalledWith(BUYER_ID, expect.anything());
  });

  it('GET /users/:id/reviews：游客可读（无 req.user 也放行）', async () => {
    const { controller, reviewService } = setupController();
    reviewService.listPublicReviews.mockResolvedValue({ list: [], page: 1, page_size: 20, total: 0 });
    const res = await controller.listPublic('1', { page: '1' });
    expect(res.code).toBe(0);
    expect(reviewService.listPublicReviews).toHaveBeenCalledWith(SELLER_ID, { page: '1' });
  });

  it('GET /users/:id/reviews：id 非法 → 9001', async () => {
    const { controller } = setupController();
    await expectBizError(controller.listPublic('abc', {}), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
});
