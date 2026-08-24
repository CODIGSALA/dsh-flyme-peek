/**
 * dsh-flyme-peek
 * Root + Flyme 小窗（windowingMode 11）工具：
 *  - open_small：小窗打开应用/网页
 *  - peek_app：小窗打开 + 截图 + UI dump（默认完成后自动关闭小窗）
 *  - close_small：主动关闭当前 Flyme 小窗
 *
 * ⚠️ 系统保护机制（2026-08-21 加入）：
 *  所有 root 命令必须通过 suCmd() 执行，并在执行前经过 assertSafeCmd()
 *  白名单校验——只允许预定义的低危命令模板，禁止 pm dump / service /
 *  settings / reboot 等高危系统操作，防止误操作导致 system_server
 *  崩溃、手机软重启。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

const execFileAsync = promisify(execFile);
const name = 'flyme-peek';
const inject = ['tools'];
const SU = '/system/bin/su';
const ART_DIR = '/storage/emulated/0/DSH/.dsh-vision-router/artifacts';

/* ============ 系统保护机制 ============ */

// 禁止 force-stop / 操作的系统关键包（含前缀匹配，防误杀系统组件）
const SYSTEM_PKG_PATTERN = /^(android|system|com\.android\.(systemui|settings|launcher3|launcher|phone|server|shell|packageinstaller|documentsui|permissioncontroller|bluetooth|nfc|location|media|webview|inputmethod|keyguard|telephony|sms|mms|dialer|contacts|providers\.settings|networkstack|net|printspooler|backup|wallpaper|quicksearchbox|vending|runtime|engine|system|statementservice|onetimeinitializer|captiveportallogin|fusedlocation|hotword|simappdialog|thememanager|settings\.intelligence|settings\.provider)$)|^(com\.meizu|com\.flyme|com\.android\.mz)/i;

// 注入字符：任何命令中出现即拒绝（shell 拼接逃逸通道）
const INJECT_PATTERN = /[;|`$]/;

// 只允许这些精确命令模板（未匹配任何模板 → 拒绝）
function assertSafeCmd(cmd) {
  const c = String(cmd || '').trim();
  if (!c) throw new Error('保护机制：空命令被拒绝');
  if (INJECT_PATTERN.test(c)) {
    throw new Error(`保护机制：命令含注入字符（; | \` $），已拒绝：${c}`);
  }

  // 1) 小窗打开：component 形态
  if (/^am start --windowingMode 11 -n [A-Za-z0-9._/:-]+$/.test(c)) return;
  // 2) 小窗打开：package + LAUNCHER 形态
  if (/^am start --windowingMode 11 -a android\.intent\.action\.MAIN -c android\.intent\.category\.LAUNCHER -p [A-Za-z0-9._:-]+$/.test(c)) return;
  // 3) 小窗打开：URL VIEW 形态（引号内仅允许 URL 安全字符，禁止换行/引号/反斜杠）
  {
    const m = c.match(/^am start --windowingMode 11 -a android\.intent\.action\.VIEW -d "([^"]*)"$/);
    if (m) {
      const url = m[1];
      if (/[\r\n"\\]/.test(url)) throw new Error('保护机制：URL 含非法字符，已拒绝');
      return;
    }
  }
  // 4) force-stop：仅普通应用（系统包保护）
  {
    const m = c.match(/^am force-stop ([A-Za-z0-9._:-]+)$/);
    if (m) {
      const pkg = m[1];
      if (SYSTEM_PKG_PATTERN.test(pkg)) {
        throw new Error(`保护机制：禁止对系统关键包 "${pkg}" 执行 force-stop`);
      }
      return;
    }
  }
  // 5) 移除小窗 task（仅数字 taskId）
  if (/^am task remove \d+$/.test(c)) return;
  // 6) 只读查询
  if (c === 'cmd window size') return;
  if (c === 'dumpsys activity activities') return;
  // 7) 模拟点击（纯数字坐标）
  if (/^input tap \d+ \d+$/.test(c)) return;
  // 8) 截图：仅允许输出到 ART_DIR 下的 peek-*.png
  if (new RegExp(`^screencap -p ${ART_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/peek-\\d+\\.png$`).test(c)) return;
  // 9) UI dump / 读取：固定路径
  if (c === 'uiautomator dump /data/local/tmp/peek_ui.xml') return;
  if (c === 'cat /data/local/tmp/peek_ui.xml') return;

  throw new Error(`保护机制：命令不在白名单内，已拒绝执行：${c}`);
}

function suCmd(cmd) {
  assertSafeCmd(cmd); // 先过保护机制，高危命令在此被拦下
  return execFileAsync(SU, ['-c', `PATH=/system/bin:/system/xbin ${cmd}`], {
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/* ============ 工具逻辑 ============ */

function buildStart(args) {
  if (args.component) {
    const c = String(args.component).trim();
    if (!/^[A-Za-z0-9._/:-]+$/.test(c)) throw new Error('component 含非法字符');
    return `am start --windowingMode 11 -n ${c}`;
  }
  if (args.package) {
    const p = String(args.package).trim();
    if (!/^[A-Za-z0-9._:-]+$/.test(p)) throw new Error('package 含非法字符');
    return `am start --windowingMode 11 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${p}`;
  }
  if (args.url) {
    const u = String(args.url).trim().replace(/"/g, '\\"');
    return `am start --windowingMode 11 -a android.intent.action.VIEW -d "${u}"`;
  }
  throw new Error('请提供 component、package 或 url 之一');
}

function pkgFromArgs(args) {
  if (args.package) return String(args.package).trim();
  if (args.component) {
    const c = String(args.component).trim();
    const slash = c.indexOf('/');
    return slash > 0 ? c.slice(0, slash) : c;
  }
  return '';
}

async function closeMiniWindow(args) {
  // 方式1：模拟点击小窗外空白区域关闭（Flyme 原生行为，不杀进程）
  try {
    // 动态获取屏幕尺寸
    let w = 1200, h = 2670;
    try {
      const { stdout: sizeOut } = await suCmd('cmd window size');
      const m = sizeOut.match(/(\d+)x(\d+)/);
      if (m) { w = Number(m[1]); h = Number(m[2]); }
    } catch (e) { /* 用默认值 */ }
    // 点击右上角空白处（小窗一般居中/偏下，右上角通常是外部区域）
    await suCmd(`input tap ${w - 60} 180`);
    await new Promise((r) => setTimeout(r, 1200));
    const { stdout } = await suCmd('dumpsys activity activities');
    if (!stdout.includes('mode=flyme-mini-window')) {
      return '已通过点击小窗外空白关闭小窗';
    }
  } catch (e) { /* 点击失败则走兜底 */ }

  // 兜底1：按包名 force-stop（系统包会被保护机制拦截，返回错误信息）
  const pkg = pkgFromArgs(args);
  if (pkg) {
    try {
      await suCmd(`am force-stop ${pkg}`);
      return `已关闭小窗（force-stop ${pkg}）`;
    } catch (e) {
      // 系统包被拦截时给出明确提示，不再继续
      if (e && e.message && e.message.includes('保护机制')) {
        return `跳过 force-stop：${e.message}`;
      }
      // fallthrough 到 task remove
    }
  }
  // 兜底2：从 dumpsys 找 flyme-mini-window task 并移除
  try {
    const { stdout } = await suCmd('dumpsys activity activities');
    const m = stdout.match(/Task\{[^#]*#(\d+)[^}]*mode=flyme-mini-window[^}]*\}/);
    if (m) {
      const taskId = m[1];
      await suCmd(`am task remove ${taskId}`);
      return `已关闭小窗（task remove ${taskId}）`;
    }
  } catch (e) { /* ignore */ }
  return '未找到可关闭的小窗';
}

function commonParams() {
  return {
    component: { type: 'string', description: '完整组件名，例如 mark.via/.Shell' },
    package: { type: 'string', description: '应用包名，例如 mark.via' },
    url: { type: 'string', description: '要打开的网页 URL' },
  };
}

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'open_small',
    description: '通过 root 在 Flyme 小窗中打开 Android 应用或网页（am start --windowingMode 11）。提供 component、package 或 url 之一。受系统保护机制约束，仅允许打开操作。',
    parameters: commonParams(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      try {
        const cmd = buildStart(args);
        const { stdout, stderr } = await suCmd(cmd);
        const target = args.component || args.package || args.url;
        return {
          ok: true,
          message: `已通过 Flyme 小窗打开：${target}\n${stdout}`.trim(),
          stdout,
          stderr,
        };
      } catch (e) {
        return {
          ok: false,
          message: `打开失败：${e && e.message || e}`,
          stdout: '',
          stderr: String(e && e.stderr || ''),
        };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'peek_app',
    description: '通过 root 在 Flyme 小窗中打开应用/网页，等待加载后截图并抓取 UI 文本，返回截图路径与文本。默认完成后自动关闭小窗（autoClose=false 可保留）。截图路径可用 vision 工具进一步查看。参数同 open_small。',
    parameters: {
      ...commonParams(),
      autoClose: { type: 'boolean', description: '完成后是否自动关闭小窗，默认 true' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          screenshotPath: { type: 'string' },
          uiText: { type: 'string' },
          closeResult: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      let closeResult = '';
      try {
        const cmd = buildStart(args);
        await suCmd(cmd);
        await new Promise((r) => setTimeout(r, 3000));
        mkdirSync(ART_DIR, { recursive: true });
        const shot = join(ART_DIR, `peek-${Date.now()}.png`);
        await suCmd(`screencap -p ${shot}`);
        let uiText = '';
        try {
          await suCmd('uiautomator dump /data/local/tmp/peek_ui.xml');
          const { stdout } = await suCmd('cat /data/local/tmp/peek_ui.xml');
          uiText = stdout.slice(0, 8000);
        } catch (e) {
          uiText = `UI dump 失败：${e && e.message || e}`;
        }
        // 默认完成任务后自动关闭小窗
        if (args.autoClose !== false) {
          closeResult = await closeMiniWindow(args);
        }
        return {
          ok: true,
          message: `已小窗打开并截图：${shot}\nUI 文本长度：${uiText.length}\n${closeResult}`.trim(),
          screenshotPath: shot,
          uiText,
          closeResult,
          stdout: '',
          stderr: '',
        };
      } catch (e) {
        return {
          ok: false,
          message: `peek 失败：${e && e.message || e}`,
          screenshotPath: '',
          uiText: '',
          closeResult,
          stdout: '',
          stderr: String(e && e.stderr || ''),
        };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'close_small',
    description: '关闭当前 Flyme 小窗。可传 package/component 指定 force-stop（系统关键包会被保护机制拦截），不传则自动查找 flyme-mini-window task 并移除。',
    parameters: commonParams(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      try {
        const result = await closeMiniWindow(args || {});
        return { ok: true, message: result };
      } catch (e) {
        return { ok: false, message: `关闭小窗失败：${e && e.message || e}` };
      }
    },
  }));
}

export { name, inject, apply };
