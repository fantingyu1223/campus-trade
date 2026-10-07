/**
 * word-list.repository.ts —— 词表配置（后台）数据访问（§5.3 #82-86 具体化）
 *
 * @module PIM-BC-06 词表管理（后台治理子域 admin/governance）
 * @table word_list → §4.24（本模块写：新增/修改/启停用，不物理删除以便追溯）；
 *        admin_operation_log → 无聚合 BC-06（§4.27 不可变日志，变更历史数据源）；
 *        admin_user → 跨 schema 只读（操作人昵称解析）
 *
 * 口径：契约 level=block/review ↔ DB high/mid、契约 status=enabled/disabled ↔
 * DB active/disabled 的映射集中于本层。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';
import type { WordLevel, WordListQuery, WordType } from './dto/word-list.dto';

/** word_list 表行（本模块消费字段集） */
export interface WordRow {
  id: bigint;
  word: string;
  type: string;
  level: string;
  status: string;
  change_note: string | null;
  changed_by: bigint | null;
  created_at: Date;
  updated_at: Date;
}

/** 变更历史日志行（admin_operation_log，target_type='word_list'） */
export interface WordLogRow {
  id: bigint;
  admin_id: bigint;
  action: string;
  reason: string;
  detail: unknown;
  created_at: Date;
}

/** 契约 level → DB：block→high（拦截）；review→mid（留痕/复核） */
export function toDbLevel(level: WordLevel): string {
  return level === 'block' ? 'high' : 'mid';
}

/** DB level → 契约：high→block；mid/low→review（low 仅提示归入复核档，有损已声明） */
export function toContractLevel(dbLevel: string): WordLevel {
  return dbLevel === 'high' ? 'block' : 'review';
}

/** 契约 status → DB：enabled→active；disabled→disabled */
export function toDbStatus(status: 'enabled' | 'disabled'): string {
  return status === 'enabled' ? 'active' : 'disabled';
}

/** DB status → 契约：active→enabled；disabled→disabled */
export function toContractStatus(dbStatus: string): 'enabled' | 'disabled' {
  return dbStatus === 'active' ? 'enabled' : 'disabled';
}

@Injectable()
export class WordListRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 列表：type 可选过滤，updated_at 倒序（最近变更优先），分页 {list,total} */
  async findPage(query: WordListQuery): Promise<{ list: WordRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (query.type !== undefined) where.type = query.type;
    const [list, total] = await Promise.all([
      this.prisma.wordList.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<WordRow[]>,
      this.prisma.wordList.count({ where }),
    ]);
    return { list, total };
  }

  async findById(id: bigint): Promise<WordRow | null> {
    return (await this.prisma.wordList.findUnique({ where: { id } })) as WordRow | null;
  }

  /** 同词库词条查重（uk_word_type：word+type 唯一） */
  async findByWordAndType(word: string, type: WordType): Promise<WordRow | null> {
    return (await this.prisma.wordList.findFirst({
      where: { word, type },
    })) as WordRow | null;
  }

  async create(data: {
    word: string;
    type: WordType;
    level: WordLevel;
    changeNote: string;
    changedBy: bigint;
  }): Promise<WordRow> {
    return (await this.prisma.wordList.create({
      data: {
        word: data.word,
        type: data.type,
        level: toDbLevel(data.level) as Prisma.WordListCreateInput['level'],
        status: 'active',
        change_note: data.changeNote,
        changed_by: data.changedBy,
      },
    })) as WordRow;
  }

  async update(
    id: bigint,
    data: { word: string; type: WordType; level: WordLevel; changeNote: string; changedBy: bigint },
  ): Promise<WordRow> {
    return (await this.prisma.wordList.update({
      where: { id },
      data: {
        word: data.word,
        type: data.type,
        level: toDbLevel(data.level) as Prisma.WordListUpdateInput['level'],
        change_note: data.changeNote,
        changed_by: data.changedBy,
      },
    })) as WordRow;
  }

  /** 启停用翻转（不物理删除，§4.24 追溯口径） */
  async updateStatus(id: bigint, dbStatus: string, changeNote: string, changedBy: bigint): Promise<WordRow> {
    return (await this.prisma.wordList.update({
      where: { id },
      data: {
        status: dbStatus as Prisma.WordListUpdateInput['status'],
        change_note: changeNote,
        changed_by: changedBy,
      },
    })) as WordRow;
  }

  /** 变更历史：admin_operation_log（target_type=word_list），created_at 倒序 */
  async findLogs(id: bigint, limit = 50): Promise<WordLogRow[]> {
    return (await this.prisma.adminOperationLog.findMany({
      where: { target_type: 'word_list', target_id: id },
      orderBy: { created_at: 'desc' },
      take: limit,
    })) as WordLogRow[];
  }

  /** 变更留痕写入（detail 含 before/after 快照） */
  async createLog(entry: {
    adminId: bigint;
    action: string;
    wordId: bigint;
    reason: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.adminOperationLog.create({
      data: {
        admin_id: entry.adminId,
        action: entry.action,
        target_type: 'word_list',
        target_id: entry.wordId,
        reason: entry.reason,
        detail: entry.detail as Prisma.InputJsonValue,
      },
    });
  }

  /** 操作人昵称解析（admin_user 跨 schema 只读） */
  async findAdminNames(ids: bigint[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.prisma.adminUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true },
    })) as Array<{ id: bigint; username: string }>;
    return new Map(rows.map((r) => [r.id.toString(), r.username]));
  }
}
