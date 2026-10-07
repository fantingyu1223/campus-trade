#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""签发本地开发用后台管理员 JWT（AdminJwtGuard 校验口径：HS256，payload 含 admin_id/role）。

背景：后台登录接口（§5.3 #51 POST /admin/v1/auth/login）尚未实现，
本地联调期间用本脚本签发 token，注入 admin-web localStorage('admin_token') 使用。

用法：
    python scripts/sign-admin-token.py [admin_id] [role] [ttl_days]
    # 默认 admin_id=1 role=admin ttl=7 天；secret 取环境变量 JWT_SECRET，
    # 缺省 campus-trade-dev-secret（与 server/.env 一致）

浏览器注入（admin-web 打开后 F12 Console 执行）：
    localStorage.setItem('admin_token', '<脚本输出的 token>')
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def main() -> None:
    admin_id = sys.argv[1] if len(sys.argv) > 1 else '1'
    role = sys.argv[2] if len(sys.argv) > 2 else 'admin'
    ttl_days = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    secret = os.environ.get('JWT_SECRET', 'campus-trade-dev-secret').encode()

    header = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    iat = int(time.time())
    payload = b64(json.dumps(
        {'admin_id': admin_id, 'role': role, 'iat': iat, 'exp': iat + ttl_days * 86400},
        separators=(',', ':'),
    ).encode())
    signing_input = f'{header}.{payload}'
    token = f'{signing_input}.{b64(hmac.new(secret, signing_input.encode(), hashlib.sha256).digest())}'
    print(token)


if __name__ == '__main__':
    main()
