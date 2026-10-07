#!/usr/bin/env bash
# ============================================================================
# check-cross-module-imports.sh —— server 模块边界扫描
#
# 规则：server/src/modules/**/*.ts 中的 import 语句，
#   - 合法：别名 @contract / @infra / @modules，以及本模块相对导入（./ 开头）
#   - 违规：import 路径以 ../ 开头（上溢到其他模块 / 跨层引用）
#
# 用法：
#   bash scripts/check-cross-module-imports.sh
#   退出码：0 = 零违规；1 = 检出违规（同时输出违规清单到 stdout）
#
# 本地验证（CI 前自查）：
#   bash scripts/check-cross-module-imports.sh && echo OK
# ============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_DIR="$ROOT/server/src/modules"

if [ ! -d "$SCAN_DIR" ]; then
  echo "WARN: $SCAN_DIR 不存在，视为零违规"
  exit 0
fi

# 匹配 import ... from '...' / import '...' / export ... from '...' 中
# 引号内以 ../ 开头的路径。兼容单双引号。
VIOLATIONS="$(grep -rnE "^[[:space:]]*(import|export)[^'\"]*['\"]\.\./" \
  "$SCAN_DIR" --include='*.ts' 2>/dev/null || true)"

if [ -n "$VIOLATIONS" ]; then
  echo "❌ 跨模块 import 违规（禁止 ../ 上溢导入，请改用 @contract/@infra 别名或 ./ 本模块导入）："
  echo "$VIOLATIONS"
  exit 1
fi

echo "✅ 跨模块 import 扫描通过：零违规"
exit 0
