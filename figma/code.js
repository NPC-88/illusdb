// DB Signature Graphics Drafter – Figma main thread
// Talks to ui.html: sends selected images in, places finished SVGs on the canvas.

figma.showUI(__html__, { width: 440, height: 780, themeColors: true, title: 'DB Signature Graphics' });

async function sendSelectionImage() {
  const sel = figma.currentPage.selection;
  for (const node of sel) {
    if (!('fills' in node) || !Array.isArray(node.fills)) continue;
    const paint = node.fills.find((p) => p.type === 'IMAGE' && p.visible !== false && p.imageHash);
    if (!paint) continue;
    try {
      const bytes = await figma.getImageByHash(paint.imageHash).getBytesAsync();
      figma.ui.postMessage({ type: 'selection-image', name: node.name, bytes });
      return;
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: 'Could not read the selected image: ' + e.message });
      return;
    }
  }
  figma.ui.postMessage({ type: 'selection-none' });
}

figma.on('selectionchange', () => figma.ui.postMessage({ type: 'selection-changed', hasImage: hasImage() }));
function hasImage() {
  return figma.currentPage.selection.some((n) => 'fills' in n && Array.isArray(n.fills) && n.fills.some((p) => p.type === 'IMAGE'));
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'init') {
    const key = await figma.clientStorage.getAsync('anthropicKey');
    const model = await figma.clientStorage.getAsync('model');
    const ws = await figma.clientStorage.getAsync('workspace');
    figma.ui.postMessage({ type: 'settings', hasKey: !!key, key: key || '', model: model || '', ws: ws || '' });
    figma.ui.postMessage({ type: 'selection-changed', hasImage: hasImage() });
  }
  if (msg.type === 'save-settings') {
    if (typeof msg.key === 'string') await figma.clientStorage.setAsync('anthropicKey', msg.key);
    if (typeof msg.model === 'string') await figma.clientStorage.setAsync('model', msg.model);
    if (typeof msg.ws === 'string') await figma.clientStorage.setAsync('workspace', msg.ws);
    figma.notify('Settings saved on this computer');
  }
  if (msg.type === 'get-selection-image') await sendSelectionImage();
  if (msg.type === 'place-svg') {
    const node = figma.createNodeFromSvg(msg.svg);
    node.name = msg.name || 'Signature Graphic';
    const anchor = figma.currentPage.selection[0];
    if (anchor && 'x' in anchor) {
      node.x = anchor.x + anchor.width + 40;
      node.y = anchor.y + anchor.height - node.height;
    } else {
      const c = figma.viewport.center;
      node.x = Math.round(c.x - node.width / 2);
      node.y = Math.round(c.y - node.height / 2);
    }
    figma.currentPage.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    figma.notify('Placed "' + node.name + '"');
  }
  if (msg.type === 'notify') figma.notify(msg.message);
};
