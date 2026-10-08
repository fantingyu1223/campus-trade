/**
 * business-error-filter.spec.ts —— BusinessError 全局异常过滤器（infra/http）
 *
 * 覆盖：
 *  - BusinessError → HTTP 200 + {code, message, data} 包络；
 *  - details 透传至 data（契约 §5.2 #27：3002 命中风险词时 data 仍返回风险详情 {hits}）；
 *  - 无 details 时 data=null；
 *  - HttpException（getStatus）按原生语义透传；未知错误 → 500。
 */
import { ArgumentsHost } from '@nestjs/common';
import { BusinessErrorFilter } from '../../src/infra/http/business-error.filter';

/** 构造最小 ArgumentsHost：捕获 status/json 调用 */
const makeHost = () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
};

/** 与生产一致的模块自含 BusinessError 形态（name='BusinessError' + code + details） */
class FakeBusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

describe('BusinessErrorFilter（§5.1 统一响应包络）', () => {
  const filter = new BusinessErrorFilter();

  it('BusinessError → HTTP 200 + {code,message,data:null}（无 details）', () => {
    const { host, res } = makeHost();
    filter.catch(new FakeBusinessError(3001, '会话不存在'), host);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 3001, message: '会话不存在', data: null });
  });

  it('details 透传至 data（@api §5.2 #27：3002 data 仍返回风险详情 {hits}）', () => {
    const { host, res } = makeHost();
    filter.catch(new FakeBusinessError(3002, '消息命中风险词，确认无误后可继续发送', { hits: ['加微信'] }), host);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 3002,
      message: '消息命中风险词，确认无误后可继续发送',
      data: { hits: ['加微信'] },
    });
  });

  it('HttpException 按原生状态码与响应体透传', () => {
    const { host, res } = makeHost();
    const httpErr = Object.assign(new Error('Unauthorized'), {
      getStatus: () => 401,
      getResponse: () => ({ statusCode: 401, message: 'Unauthorized' }),
    });
    filter.catch(httpErr, host);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 401, message: 'Unauthorized' });
  });

  it('未知错误 → 500 Internal server error', () => {
    const { host, res } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
