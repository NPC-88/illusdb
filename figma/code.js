// DB Signature Graphics Drafter – Figma main thread
// Talks to ui.html: sends selected images in, places finished SVGs on the canvas.

figma.showUI(__html__, { width: 460, height: 860, themeColors: true, title: 'DB Signature Graphics' });

async function sendSelectionImages() {
  // every selected layer with an image fill, up to 4 (the plugin takes 4 photos per landmark)
  const images = [];
  for (const node of figma.currentPage.selection) {
    if (images.length >= 4) break;
    if (!('fills' in node) || !Array.isArray(node.fills)) continue;
    const paint = node.fills.find((p) => p.type === 'IMAGE' && p.visible !== false && p.imageHash);
    if (!paint) continue;
    try { images.push({ name: node.name, bytes: await figma.getImageByHash(paint.imageHash).getBytesAsync() }); }
    catch (e) { figma.ui.postMessage({ type: 'error', message: 'Could not read the image in "' + node.name + '": ' + e.message }); }
  }
  figma.ui.postMessage(images.length ? { type: 'selection-images', images } : { type: 'selection-none' });
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
  if (msg.type === 'get-selection-image') await sendSelectionImages();
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
