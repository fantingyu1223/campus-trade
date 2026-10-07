/**
 * user/user.module.ts —— user 模块装配（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * PrismaService 为 infra 层共享连接设施，在此注册为本模块 provider。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [PrismaService, UserRepository, UserService],
  exports: [UserService],
})
export class UserModule {}
