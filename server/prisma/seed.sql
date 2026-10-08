-- seed.sql —— 本地开发最小种子数据（2026-02-06）
-- 用法：docker exec -i campus-trade-mysql mysql -uroot -pcampus123 --default-character-set=utf8mb4 campus_trade < server/prisma/seed.sql
-- 注意：必须带 --default-character-set=utf8mb4，否则中文会以 latin1 双重编码入库
SET NAMES utf8mb4;

INSERT INTO `school` VALUES (1,'示范大学','示大','@demo.edu.cn','北京','active',1,'2026-10-06 22:31:07','2026-10-06 22:31:07');
INSERT INTO `category` VALUES (1,0,'教材书籍','',1,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (2,0,'数码电子','',2,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (3,0,'生活用品','',3,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (4,0,'服饰鞋包','',4,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (5,1,'教材教辅','',1,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (6,1,'考试用书','',2,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (7,2,'手机/平板','',1,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (8,2,'笔记本电脑','',2,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (9,2,'耳机/音箱','',3,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (10,3,'宿舍用品','',1,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (11,3,'洗护清洁','',2,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (12,0,'其他闲置',NULL,5,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `category` VALUES (13,12,'其他',NULL,1,'active','2026-10-06 22:34:05','2026-10-06 22:34:05');
INSERT INTO `user` VALUES (1,'mock_seller_001',NULL,'张同学','','å¤§å››å­¦å§å‡ºé—²ç½®','student',1,'normal',NULL,NULL,'2026-10-06 15:00:28',NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-06 22:34:05','2026-10-06 15:00:28');
INSERT INTO `user` VALUES (2,'mock_buyer_001',NULL,'李同学','','å¤§äºŒå­¦å¼Ÿ','student',1,'normal',NULL,NULL,'2026-10-06 15:00:28',NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-06 22:34:05','2026-10-06 15:00:28');
-- 后台种子管理员：初始密码 Admin@2026（bcrypt 哈希，§5.3 #51 登录可用）；
-- ON DUPLICATE KEY UPDATE 保证种子可重复执行（重跑会重置该账号密码/角色/状态）
INSERT INTO `admin_user` VALUES (1,'admin','$2b$10$1K6ZOe3dfQwQwApl6Hpez.IdSyLtLakqR8dlo/TuszulkFFVH8xeG','admin','active',NULL,'2026-10-06 22:34:05','2026-10-06 22:34:05')
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), status=VALUES(status);

INSERT INTO `product` (id,seller_id,school_id,category_id,title,description,condition_level,price,original_price,trade_mode,meet_location,status,is_urgent,view_count,favorite_count,published_at,created_at,updated_at) VALUES (1,1,1,5,'高等数学（下册）教材 九成新','同济第七版，无笔记划痕','like_new',15.00,45.00,'both','东区食堂门口','on_sale',0,0,0,NOW(6),NOW(6),NOW(6));
INSERT INTO `product_image` (product_id,image_url,sort_order,created_at,updated_at) VALUES (1,'http://localhost:3000/static/placeholder.png',0,NOW(6),NOW(6));
INSERT INTO `product` (id,seller_id,school_id,category_id,title,description,condition_level,price,original_price,trade_mode,meet_location,status,is_urgent,view_count,favorite_count,published_at,created_at,updated_at) VALUES (2,1,1,9,'索尼 WH-1000XM4 降噪耳机','购于去年，箱说齐全，功能正常','good',800.00,1999.00,'both','东区食堂门口','on_sale',0,0,0,NOW(6),NOW(6),NOW(6));
INSERT INTO `product_image` (product_id,image_url,sort_order,created_at,updated_at) VALUES (2,'http://localhost:3000/static/placeholder.png',0,NOW(6),NOW(6));
INSERT INTO `product` (id,seller_id,school_id,category_id,title,description,condition_level,price,original_price,trade_mode,meet_location,status,is_urgent,view_count,favorite_count,published_at,created_at,updated_at) VALUES (3,1,1,10,'宿舍小台灯 USB 充电款','三档调光，续航正常','like_new',12.00,29.00,'both','东区食堂门口','on_sale',0,0,0,NOW(6),NOW(6),NOW(6));
INSERT INTO `product_image` (product_id,image_url,sort_order,created_at,updated_at) VALUES (3,'http://localhost:3000/static/placeholder.png',0,NOW(6),NOW(6));
INSERT INTO `product` (id,seller_id,school_id,category_id,title,description,condition_level,price,original_price,trade_mode,meet_location,status,is_urgent,view_count,favorite_count,published_at,created_at,updated_at) VALUES (4,1,1,6,'考研英语红宝书全套','2026 版，几乎全新','new',35.00,88.00,'both','东区食堂门口','on_sale',0,0,0,NOW(6),NOW(6),NOW(6));
INSERT INTO `product_image` (product_id,image_url,sort_order,created_at,updated_at) VALUES (4,'http://localhost:3000/static/placeholder.png',0,NOW(6),NOW(6));
INSERT INTO `product` (id,seller_id,school_id,category_id,title,description,condition_level,price,original_price,trade_mode,meet_location,status,is_urgent,view_count,favorite_count,published_at,created_at,updated_at) VALUES (5,1,1,7,'iPad 2019 128G WiFi 版','自用两年，屏幕无划痕，带保护壳','good',1200.00,2999.00,'both','东区食堂门口','on_sale',0,0,0,NOW(6),NOW(6),NOW(6));
INSERT INTO `product_image` (product_id,image_url,sort_order,created_at,updated_at) VALUES (5,'http://localhost:3000/static/placeholder.png',0,NOW(6),NOW(6));
