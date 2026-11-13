"""真实 MySQL 集成测试包（``C-INTEGRATION@1``）。

只有设置 ``XIANGSHENG_MYSQL_TEST_URL`` 时这些用例才会执行；未配置时整体跳过，
保证默认 ``cd backend && python -m pytest -q`` 基线在无 MySQL 的机器上仍可运行。
"""