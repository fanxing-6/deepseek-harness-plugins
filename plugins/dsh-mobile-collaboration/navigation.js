export function synchronizeNavigation(ctx, controller) {
  let applying = false, queued = false, disposed = false, pending = false, revision = 0;
  const snapshot = () => ({ selection: ctx.uiWorkspace.selection.getSnapshot(), panelId: ctx.layout.panelInfo.getSnapshot().activePanelId });
  let previous = JSON.stringify(snapshot());
  const publish = (force = false) => {
    const state = snapshot(), key = JSON.stringify(state);
    if (!force && key === previous) return;
    previous = key;
    if (!applying && !pending && controller.handle && (controller.mobile ? controller.paired : controller.state.selected)) controller.send({ type: 'navigation', state });
  };
  const changed = () => {
    if (applying || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!disposed) publish(); });
  };
  controller.publishNavigation = () => publish(true);
  const offSelection = ctx.uiWorkspace.selection.subscribe(changed);
  const offPanel = ctx.layout.panelInfo.subscribe(changed);
  const apply = async (state, request) => {
    const { sessionId, subagentAddress } = state.selection;
    if (sessionId && !ctx.sessions.list.getSnapshot().byId[sessionId]) await ctx.sessions.refresh();
    if (disposed || request !== revision) return;
    if (sessionId && !ctx.sessions.list.getSnapshot().byId[sessionId]) throw new Error('同步目标会话尚未登记：' + sessionId);
    applying = true;
    try {
      if (JSON.stringify(snapshot().selection) !== JSON.stringify(state.selection)) {
        if (sessionId) ctx.uiWorkspace.openSession(subagentAddress ?? sessionId);
        else ctx.uiWorkspace.clearMain();
      }
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== state.panelId) ctx.layout.selectPanel(state.panelId);
      previous = JSON.stringify(snapshot());
    } finally { applying = false; }
  };
  const offFrame = controller.onFrame(data => {
    if (data.type === 'start') controller.paired = true;
    if (['stop', 'stopped', 'offline'].includes(data.type)) { controller.paired = false; pending = false; revision++; }
    if (data.type !== 'navigation') return;
    const request = ++revision; pending = true;
    void apply(data.state, request).catch(error => {
      if (disposed || request !== revision) return;
      controller.update({ error: error.message });
      if (controller.handle) controller.send({ type: 'notice', text: error.message });
    }).finally(() => { if (request === revision) pending = false; });
  });
  return () => { disposed = true; revision++; offSelection(); offPanel(); offFrame(); controller.publishNavigation = null; };
}
