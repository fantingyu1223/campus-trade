-- CreateTable
CREATE TABLE `user` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `openid` VARCHAR(64) NOT NULL,
    `unionid` VARCHAR(64) NULL,
    `nickname` VARCHAR(64) NOT NULL DEFAULT '',
    `avatar_url` VARCHAR(512) NOT NULL DEFAULT '',
    `bio` VARCHAR(500) NOT NULL DEFAULT '',
    `identity_type` ENUM('guest', 'student', 'staff', 'merchant') NOT NULL DEFAULT 'guest',
    `school_id` BIGINT UNSIGNED NULL,
    `status` ENUM('normal', 'banned', 'readonly', 'clearance', 'cancelled') NOT NULL DEFAULT 'normal',
    `banned_reason` VARCHAR(255) NULL,
    `banned_at` DATETIME(0) NULL,
    `last_login_at` DATETIME(0) NULL,
    `graduation_at` DATETIME(0) NULL,
    `clearance_started_at` DATETIME(0) NULL,
    `logout_requested_at` DATETIME(0) NULL,
    `postpone_until` DATETIME(0) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `real_name_masked` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_unionid`(`unionid`),
    INDEX `idx_school_status`(`school_id`, `status`),
    INDEX `idx_status_graduation`(`status`, `graduation_at`),
    UNIQUE INDEX `uk_openid`(`openid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_verification` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `school_id` BIGINT UNSIGNED NOT NULL,
    `verify_type` ENUM('student_no', 'campus_email') NOT NULL,
    `student_no` VARCHAR(64) NULL,
    `campus_email` VARCHAR(128) NULL,
    `real_name` VARCHAR(64) NULL,
    `staff_flag` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reject_reason` VARCHAR(255) NULL,
    `submitted_at` DATETIME(0) NOT NULL,
    `reviewed_at` DATETIME(0) NULL,
    `reviewer_id` BIGINT UNSIGNED NULL,
    `valid_until` DATETIME(0) NULL,
    `major` VARCHAR(128) NULL,
    `enrollment_year` SMALLINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status_submitted`(`status`, `submitted_at`),
    INDEX `idx_valid_until`(`status`, `valid_until`),
    UNIQUE INDEX `uk_user_school`(`user_id`, `school_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `block` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `blocker_id` BIGINT UNSIGNED NOT NULL,
    `blocked_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_blocked`(`blocked_id`),
    UNIQUE INDEX `uk_blocker_blocked`(`blocker_id`, `blocked_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_application` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `shop_name` VARCHAR(128) NOT NULL,
    `license_image_url` VARCHAR(512) NOT NULL,
    `shop_proof_image_url` VARCHAR(512) NULL,
    `contact_phone` VARCHAR(32) NOT NULL,
    `shop_address` VARCHAR(255) NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `reject_reason_code` ENUM('license_invalid', 'license_unclear', 'info_mismatch', 'shop_proof_missing', 'duplicate_shop', 'blacklisted', 'scope_not_allowed', 'other') NULL,
    `reject_reason_detail` VARCHAR(500) NULL,
    `submitted_at` DATETIME(0) NOT NULL,
    `sla_deadline` DATETIME(0) NOT NULL,
    `reviewed_at` DATETIME(0) NULL,
    `reviewer_id` BIGINT UNSIGNED NULL,
    `cooldown_until` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_status`(`user_id`, `status`),
    INDEX `idx_status_sla`(`status`, `sla_deadline`),
    INDEX `idx_user_cooldown`(`user_id`, `cooldown_until`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_ban_list` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `license_no` VARCHAR(128) NULL,
    `phone` VARCHAR(32) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `banned_by` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('active', 'lifted') NOT NULL DEFAULT 'active',
    `lifted_at` DATETIME(0) NULL,
    `lifted_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user`(`user_id`),
    INDEX `idx_license`(`license_no`),
    INDEX `idx_phone`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `short_name` VARCHAR(64) NOT NULL DEFAULT '',
    `email_suffix` VARCHAR(128) NULL,
    `city` VARCHAR(64) NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `allow_join_application` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status`(`status`),
    UNIQUE INDEX `uk_name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_join_application` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `school_id` BIGINT UNSIGNED NOT NULL,
    `student_no` VARCHAR(64) NULL,
    `proof_image_url` VARCHAR(512) NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reject_reason` VARCHAR(255) NULL,
    `submitted_at` DATETIME(0) NOT NULL,
    `reviewed_at` DATETIME(0) NULL,
    `reviewer_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_status`(`user_id`, `status`),
    INDEX `idx_school_status`(`school_id`, `status`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `category` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `name` VARCHAR(64) NOT NULL,
    `icon_url` VARCHAR(512) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_parent_status`(`parent_id`, `status`, `sort_order`),
    UNIQUE INDEX `uk_parent_name`(`parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `school_id` BIGINT UNSIGNED NOT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `description` TEXT NOT NULL,
    `condition_level` ENUM('new', 'like_new', 'good', 'fair', 'poor') NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `original_price` DECIMAL(10, 2) NULL,
    `trade_mode` ENUM('meet', 'online', 'both') NOT NULL DEFAULT 'both',
    `meet_location` VARCHAR(255) NULL,
    `available_time` VARCHAR(255) NULL,
    `status` ENUM('on_sale', 'off_sale', 'trading', 'sold') NOT NULL DEFAULT 'on_sale',
    `is_urgent` BOOLEAN NOT NULL DEFAULT false,
    `view_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `favorite_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `sold_buyer_id` BIGINT UNSIGNED NULL,
    `sold_at` DATETIME(0) NULL,
    `off_sale_at` DATETIME(0) NULL,
    `published_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_school_category_status`(`school_id`, `category_id`, `status`, `published_at`),
    INDEX `idx_seller_status`(`seller_id`, `status`),
    INDEX `idx_status_published`(`status`, `published_at`),
    INDEX `idx_sold_buyer`(`sold_buyer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_image` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(512) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_product`(`product_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `favorite` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_product`(`product_id`),
    UNIQUE INDEX `uk_user_product`(`user_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `want_buy` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `school_id` BIGINT UNSIGNED NOT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `price_min` DECIMAL(10, 2) NULL,
    `price_max` DECIMAL(10, 2) NULL,
    `condition_level` ENUM('new', 'like_new', 'good', 'fair', 'poor') NULL,
    `status` ENUM('active', 'closed', 'bought', 'expired') NOT NULL DEFAULT 'active',
    `expire_at` DATETIME(0) NOT NULL,
    `renewed_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `renewed_at` DATETIME(0) NULL,
    `closed_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_school_category_status`(`school_id`, `category_id`, `status`, `expire_at`),
    INDEX `idx_user_status`(`user_id`, `status`),
    INDEX `idx_status_expire`(`status`, `expire_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `word_list` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `word` VARCHAR(128) NOT NULL,
    `type` ENUM('risk', 'violation', 'prohibited') NOT NULL,
    `level` ENUM('high', 'mid', 'low') NOT NULL DEFAULT 'mid',
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `change_note` VARCHAR(255) NULL,
    `changed_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_type_status`(`type`, `status`),
    UNIQUE INDEX `uk_word_type`(`word`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_warning` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `rule_code` ENUM('daily_ge5', 'cross_ge3_cat', 'suspected_merchant') NOT NULL,
    `rule_snapshot` JSON NULL,
    `status` ENUM('pending', 'confirmed', 'false_alarm') NOT NULL DEFAULT 'pending',
    `handled_by` BIGINT UNSIGNED NULL,
    `handled_at` DATETIME(0) NULL,
    `handle_note` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status_created`(`status`, `created_at`),
    INDEX `idx_user_rule`(`user_id`, `rule_code`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `buyer_id` BIGINT UNSIGNED NOT NULL,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `buyer_unread_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `seller_unread_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `last_message_content` VARCHAR(255) NULL,
    `last_message_type` ENUM('text', 'image', 'intent_card') NULL,
    `last_message_sender_id` BIGINT UNSIGNED NULL,
    `last_message_at` DATETIME(0) NULL,
    `buyer_deleted` BOOLEAN NOT NULL DEFAULT false,
    `seller_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_buyer`(`buyer_id`, `buyer_deleted`, `last_message_at`),
    INDEX `idx_seller`(`seller_id`, `seller_deleted`, `last_message_at`),
    UNIQUE INDEX `uk_pair_product`(`buyer_id`, `seller_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `sender_id` BIGINT UNSIGNED NOT NULL,
    `receiver_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('text', 'image', 'intent_card') NOT NULL DEFAULT 'text',
    `content` TEXT NULL,
    `image_url` VARCHAR(512) NULL,
    `intent_payload` JSON NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_conversation`(`conversation_id`, `created_at`),
    INDEX `idx_receiver_read`(`receiver_id`, `is_read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_risk_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `message_id` BIGINT UNSIGNED NOT NULL,
    `sender_id` BIGINT UNSIGNED NOT NULL,
    `receiver_id` BIGINT UNSIGNED NOT NULL,
    `hit_word` VARCHAR(128) NOT NULL,
    `content_snapshot` TEXT NOT NULL,
    `level` ENUM('high', 'mid', 'low') NOT NULL,
    `action` ENUM('logged', 'blocked', 'warned') NOT NULL DEFAULT 'logged',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_level_created`(`level`, `created_at`),
    INDEX `idx_sender`(`sender_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trade_intent` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `initiator_id` BIGINT UNSIGNED NOT NULL,
    `trade_mode` ENUM('offline_meet', 'online_pay') NOT NULL,
    `meet_time` DATETIME(0) NULL,
    `meet_location` VARCHAR(255) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `buyer_confirmed_at` DATETIME(0) NULL,
    `seller_confirmed_at` DATETIME(0) NULL,
    `status` ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_conversation`(`conversation_id`, `created_at`),
    INDEX `idx_product_status`(`product_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `violation_intercept_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scene` ENUM('product_publish', 'product_edit', 'chat', 'want_buy', 'review') NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `target_id` BIGINT UNSIGNED NULL,
    `hit_word` VARCHAR(128) NOT NULL,
    `content_snapshot` TEXT NOT NULL,
    `action` ENUM('blocked', 'masked', 'warned') NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_scene_created`(`scene`, `created_at`),
    INDEX `idx_user`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trade_order` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `trade_intent_id` BIGINT UNSIGNED NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `product_title` VARCHAR(128) NOT NULL,
    `buyer_id` BIGINT UNSIGNED NOT NULL,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `trade_mode` ENUM('offline_meet', 'online_pay') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending_delivery', 'pending_confirm', 'completed', 'cancelled', 'appealing') NOT NULL DEFAULT 'pending_delivery',
    `meet_time` DATETIME(0) NULL,
    `timeout_deadline` DATETIME(0) NULL,
    `cancel_initiator_id` BIGINT UNSIGNED NULL,
    `cancel_requested_at` DATETIME(0) NULL,
    `cancel_deadline` DATETIME(0) NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `cancel_reject_note` VARCHAR(255) NULL,
    `confirmed_at` DATETIME(0) NULL,
    `completed_at` DATETIME(0) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_buyer`(`buyer_id`, `status`, `created_at`),
    INDEX `idx_seller`(`seller_id`, `status`, `created_at`),
    INDEX `idx_status_deadline`(`status`, `timeout_deadline`),
    INDEX `idx_cancel_deadline`(`status`, `cancel_deadline`),
    UNIQUE INDEX `uk_order_no`(`order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `from_status` ENUM('pending_delivery', 'pending_confirm', 'completed', 'cancelled', 'appealing') NULL,
    `to_status` ENUM('pending_delivery', 'pending_confirm', 'completed', 'cancelled', 'appealing') NOT NULL,
    `actor` ENUM('buyer', 'seller', 'system', 'admin') NOT NULL,
    `actor_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_order`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `channel` ENUM('offline_scan', 'cash', 'wechat_pay') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending', 'paid', 'refunded', 'refund_failed') NOT NULL DEFAULT 'pending',
    `external_txn_id` VARCHAR(128) NULL,
    `refund_status` ENUM('none', 'processing', 'success', 'failed') NULL,
    `refund_amount` DECIMAL(10, 2) NULL,
    `refund_requested_at` DATETIME(0) NULL,
    `refunded_at` DATETIME(0) NULL,
    `refund_fail_reason` VARCHAR(255) NULL,
    `paid_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_order`(`order_id`),
    INDEX `idx_status_refund`(`status`, `refund_status`),
    UNIQUE INDEX `uk_external_txn`(`channel`, `external_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `reviewer_id` BIGINT UNSIGNED NOT NULL,
    `reviewee_id` BIGINT UNSIGNED NOT NULL,
    `rating` TINYINT UNSIGNED NOT NULL,
    `content` VARCHAR(500) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_public` BOOLEAN NOT NULL DEFAULT false,
    `review_deadline` DATETIME(0) NOT NULL,
    `public_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_reviewee`(`reviewee_id`, `is_public`, `created_at`),
    INDEX `idx_default_deadline`(`is_default`, `review_deadline`),
    UNIQUE INDEX `uk_order_reviewer`(`order_id`, `reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `reporter_id` BIGINT UNSIGNED NOT NULL,
    `target_type` ENUM('product', 'user', 'merchant', 'chat') NOT NULL,
    `target_id` BIGINT UNSIGNED NOT NULL,
    `category` ENUM('fraud', 'prohibited', 'false_desc', 'other') NOT NULL,
    `content` VARCHAR(1000) NOT NULL,
    `evidence_urls` JSON NULL,
    `status` ENUM('pending', 'processing', 'resolved') NOT NULL DEFAULT 'pending',
    `result` ENUM('off_shelf', 'warning', 'ban', 'rejected') NULL,
    `sla_level` ENUM('urgent', 'high', 'normal') NOT NULL DEFAULT 'normal',
    `sla_deadline` DATETIME(0) NOT NULL,
    `is_timeout` BOOLEAN NOT NULL DEFAULT false,
    `handled_by` BIGINT UNSIGNED NULL,
    `handled_at` DATETIME(0) NULL,
    `handle_note` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status_sla`(`status`, `sla_deadline`),
    INDEX `idx_reporter`(`reporter_id`, `created_at`),
    INDEX `idx_target`(`target_type`, `target_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appeal` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `appellant_id` BIGINT UNSIGNED NOT NULL,
    `appeal_type` ENUM('dispute', 'punishment') NOT NULL,
    `target_id` BIGINT UNSIGNED NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `evidence_urls` JSON NULL,
    `status` ENUM('pending', 'processing', 'resolved', 'expired') NOT NULL DEFAULT 'pending',
    `intervene_deadline` DATETIME(0) NOT NULL,
    `valid_until` DATETIME(0) NOT NULL,
    `result` ENUM('support', 'reject', 'partial') NULL,
    `handled_by` BIGINT UNSIGNED NULL,
    `handled_at` DATETIME(0) NULL,
    `handle_note` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status_intervene`(`status`, `intervene_deadline`),
    INDEX `idx_appellant`(`appellant_id`, `created_at`),
    INDEX `idx_target`(`appeal_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_user` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('auditor', 'admin') NOT NULL DEFAULT 'auditor',
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `last_login_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_username`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_operation_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `admin_id` BIGINT UNSIGNED NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(32) NULL,
    `target_id` BIGINT UNSIGNED NULL,
    `reason` VARCHAR(500) NOT NULL,
    `detail` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_admin`(`admin_id`, `created_at`),
    INDEX `idx_action`(`action`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('new_message', 'price_change', 'want_buy_match', 'order_status', 'report_result', 'appeal_result', 'review_remind', 'want_buy_expire') NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `payload` JSON NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_user_read`(`user_id`, `is_read`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- FULLTEXT 索引（Prisma 不支持声明式表达，手工追加，见 schema.prisma 头注第 6 条）
ALTER TABLE `product` ADD FULLTEXT INDEX `idx_ft_title_desc` (`title`, `description`) WITH PARSER ngram;
