const vscode = require('vscode');

const ACTIVE_WINDOW = 30 * 60_000;
let item;
let lastActive = 0;

const cfg = () => vscode.workspace.getConfiguration('mcaction');

function isLate() {
  const hour = new Date().getHours();
  return hour >= cfg().get('fromHour') || hour < 5;
}

async function call(path, init = {}) {
  const res = await fetch(cfg().get('server') + path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-mcaction-key': cfg().get('key') },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || res.statusText);
  return data;
}

/** 深夜 + 最近 30 分钟有保存文件，才显示夜宵价 */
async function refresh() {
  if (!isLate() || Date.now() - lastActive > ACTIVE_WINDOW) return item.hide();
  try {
    const peek = await call(`/v1/peek?scene=${encodeURIComponent(cfg().get('scene'))}`);
    item.text = `$(flame) ${peek.sceneLabel} ¥${peek.total}`;
    item.tooltip = `${peek.say}\n\n点击下单`;
    item.show();
  } catch {
    item.hide();
  }
}

async function order() {
  const plan = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '麦一下：试算中…' },
    () => call('/v1/plan', { method: 'POST', body: JSON.stringify({ scene: cfg().get('scene') }) }),
  );
  if (plan.stage === 'blocked') return vscode.window.showWarningMessage(plan.say, { modal: true });
  const pick = await vscode.window.showInformationMessage(plan.say, { modal: true }, '下单');
  if (pick !== '下单') return;
  const done = await call(`/v1/confirm/${plan.planId}`, { method: 'POST' });
  await vscode.env.openExternal(vscode.Uri.parse(done.payPage || done.payUrl));
}

function activate(context) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'mcaction.order';

  const timer = setInterval(refresh, 10 * 60_000);
  context.subscriptions.push(
    item,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('mcaction.order', () =>
      order().catch((err) => vscode.window.showErrorMessage(`麦一下：${err.message}`)),
    ),
    vscode.workspace.onDidSaveTextDocument(() => {
      const wasIdle = Date.now() - lastActive > ACTIVE_WINDOW;
      lastActive = Date.now();
      if (wasIdle) refresh();
    }),
  );
}

module.exports = { activate, deactivate() {} };
