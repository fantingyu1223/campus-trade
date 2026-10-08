-- DropIndex
DROP INDEX `idx_ft_title_desc` ON `product`;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `is_anonymous` BOOLEAN NOT NULL DEFAULT false;

-- FULLTEXT 索引（Prisma 不支持声明式表达，migrate dev 会将其识别为漂移而 DropIndex，
-- 按 schema.prisma 头注第 6 条在此手工追加重建，与 0001_init 口径一致）
ALTER TABLE `product` ADD FULLTEXT INDEX `idx_ft_title_desc` (`title`, `description`) WITH PARSER ngram;
