# dsh-flyme-peek

DSH 插件：通过 root 调用 Flyme 私有小窗模式（`windowingMode 11`）在魅族手机上打开应用/网页，并可截图 + UI dump 查看内容。

## 工具

- **open_small**：小窗打开应用或网页（`am start --windowingMode 11`）
- **peek_app**：小窗打开 + 截图 + UI dump（默认完成后自动关闭小窗）
- **close_small**：关闭当前 Flyme 小窗（优先模拟点击小窗外空白，兜底 force-stop/task remove）

## 要求

- 魅族 Flyme 12.6+（小窗私有模式）
- root（`/system/bin/su` 可用，KernelSU/Magisk 均可）
- DSH 环境

## 安装

```bash
dsh plugin add file:/path/to/dsh-flyme-peek
```

## 安全机制

所有 root 命令经 `assertSafeCmd()` 白名单校验：只允许预定义的低危命令模板，禁止 `pm dump` / `service` / `settings` / `reboot` 等高危操作，并保护系统关键包（`android` / `com.android.*` / `com.meizu` / `com.flyme`）免被 force-stop，防止误操作导致 system_server 崩溃。

## License

MIT
