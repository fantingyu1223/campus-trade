/**
 * infra/prisma.service.ts —— Prisma 连接基础设施（docs/design §3.1：infra 层仅纯技术设施）。
 *
 * 全模块共享的 PrismaClient 封装：生命周期随 Nest 模块启停连接/断开。
 * 本文件不含任何业务逻辑；各模块 repository 注入本服务直查本 schema 表。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
