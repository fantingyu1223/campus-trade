/**
 * word-list.service.ts —— 词表配置业务逻辑（§5.3 #82-86 具体化，PRD F22/F13）
 *
 * @module PIM-BC-06 词表管理（后台治理子域 admin/governance）
 * @rule CIM-R-08 违规词表驱动的文本拦截（词表为拦截规则唯一事实源）
 * @api §5.3 #82-86 + @ac F22-AC1（拦截词表运营可配）、F13-AC3（风险词同源）
 *
 * 快照生效口径（MVP）：变更成功后调用 infra WordInterceptorService.refresh()
 * 主动刷新 DB 词表快照（§4.24 应用缓存+变更失效）；注意 product/chat 模块当前
 * 消费的是代码内冻结快照（infra-snapshot/word-snapshot.ts，PRD §8.1 首期词集），
 * DB 变更对其需重新部署生效——切换消费方待架构师裁决，见交接遗留。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import { WordInterceptorService } from '@infra/word-interceptor/word-interceptor.service';
import {
  WordListRepository,
  toContractLevel,
  toContractStatus,
  type WordRow,
} from './word-list.repository';
import { validateWordListQuery, validateWordPayload } from './word-list.validator';

/** 业务异常载体：code 为契约错误码，全局 BusinessErrorFilter 映射统一包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 序列化词条为契约口径（level block/review、status enabled/disabled） */
function serializeWord(row: WordRow) {
  return {
    id: String(row.id),
    word: row.word,
    type: row.type,
    level: toContractLevel(row.level),
    status: toContractStatus(row.status),
    updated_at: row.updated_at.toISOString(),
  };
}

/** 留痕快照（before/after 用 DB 原值，精确追溯） */
function snapshot(row: WordRow) {
  return { word: row.word, type: row.type, level: row.level, status: row.status };
}

@Injectable()
export class WordListService {
  constructor(
    private readonly repo: WordListRepository,
    /** 可选注入：DB 词表快照拦截器（变更后 refresh 生效）；缺省不刷新（测试便利） */
    private readonly interceptor?: WordInterceptorService,
  ) {}

  /** GET /admin/v1/word-lists 分页列表（type 过滤，最近变更优先） */
  async list(rawQuery: unknown) {
    const query = validateWordListQuery(rawQuery);
    const { list, total } = await this.repo.findPage(query);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      list: list.map(serializeWord),
    };
  }

  /** POST /admin/v1/word-lists 新增词条（同词库查重），留痕 + 快照刷新 */
  async create(adminId: string, rawBody: unknown) {
    const body = validateWordPayload(rawBody);
    const dup = await this.repo.findByWordAndType(body.word, body.type);
    if (dup) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '同词库内词条已存在');
    }
    const note = body.note?.trim() ? body.note : `新增词条 ${body.word}`;
    const created = await this.repo.create({
      word: body.word,
      type: body.type,
      level: body.level,
      changeNote: note,
      changedBy: BigInt(adminId),
    });
    await this.repo.createLog({
      adminId: BigInt(adminId),
      action: 'word_list.create',
      wordId: created.id,
      reason: note,
      detail: { before: null, after: snapshot(created) },
    });
    await this.interceptor?.refresh();
    return { word: serializeWord(created) };
  }

  /** PUT /admin/v1/word-lists/:id 修改词条（排除自身查重），留痕 before/after */
  async update(adminId: string, id: bigint, rawBody: unknown) {
    const body = validateWordPayload(rawBody);
    const existing = await this.repo.findById(id);
    if (!existing) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '词条不存在');

    const dup = await this.repo.findByWordAndType(body.word, body.type);
    if (dup && dup.id !== id) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '同词库内词条已存在');
    }

    const note = body.note?.trim() ? body.note : `修改词条 #${id}`;
    const updated = await this.repo.update(id, {
      word: body.word,
      type: body.type,
      level: body.level,
      changeNote: note,
      changedBy: BigInt(adminId),
    });
    await this.repo.createLog({
      adminId: BigInt(adminId),
      action: 'word_list.update',
      wordId: id,
      reason: note,
      detail: { before: snapshot(existing), after: snapshot(updated) },
    });
    await this.interceptor?.refresh();
    return { word: serializeWord(updated) };
  }

  /** POST /admin/v1/word-lists/:id/toggle 启用/停用翻转（不物理删除） */
  async toggle(adminId: string, id: bigint) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '词条不存在');

    const nextDb = existing.status === 'active' ? 'disabled' : 'active';
    const note = `${nextDb === 'active' ? '启用' : '停用'}词条 ${existing.word}`;
    const updated = await this.repo.updateStatus(id, nextDb, note, BigInt(adminId));
    await this.repo.createLog({
      adminId: BigInt(adminId),
      action: 'word_list.toggle',
      wordId: id,
      reason: note,
      detail: { before: { status: existing.status }, after: { status: nextDb } },
    });
    await this.interceptor?.refresh();
    return { word: { status: toContractStatus(updated.status) } };
  }

  /** GET /admin/v1/word-lists/:id/history 变更历史（admin_operation_log 映射） */
  async history(id: bigint) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '词条不存在');

    const logs = await this.repo.findLogs(id);
    const names = await this.repo.findAdminNames([...new Set(logs.map((l) => l.admin_id))]);

    return {
      history: logs.map((log) => {
        const detail = (log.detail ?? {}) as { before?: unknown; after?: unknown };
        return {
          time: log.created_at.toISOString(),
          operator: names.get(String(log.admin_id)) ?? String(log.admin_id),
          // action 'word_list.create/update/toggle' → 契约口径 create/update/toggle
          action: log.action.replace(/^word_list\./, ''),
          before: (detail.before ?? null) as Record<string, unknown> | null,
          after: (detail.after ?? null) as Record<string, unknown> | null,
        };
      }),
    };
  }
}
