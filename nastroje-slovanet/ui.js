  const ui = (() => {

  const _downlaod_urls = [];
  function createDownloadLink(uint8arr) {
    const blob = new Blob([uint8arr]);
    const url = window.URL.createObjectURL(blob, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    _downlaod_urls.push(url);

    const link = document.getElementById('export-download-link')
    link.href = link.innerText = url;

    document.getElementById('export-download-dialog').style = 'display:none';

    return url;
  }

  function revokeDownloadUrls() {
    console.debug('Rewoking download URLs');
    _downlaod_urls.forEach(url => window.URL.revokeObjectURL(url));
  }

  function closeExportDialog() {
    ui.revokeDownloadUrls();
    document.getElementById('export-download-dialog').style = 'display:none';
  }

  function showResultDialog(title, message, code = '') {
    document.getElementById('result-dialog-title').innerText = title;
    document.getElementById('result-dialog-messge').innerText = message || title;
    if (code) {
      document.getElementById('result-dialog-code').innerText = code;
      document.getElementById('result-dialog-code-pre').style = '';
    }
    document.getElementById('result-dialog').style = '';
  }

  function closeResultDialog() {
    document.getElementById('result-dialog-code').innerText = '';
    document.getElementById('result-dialog-code-pre').style = 'display:none';
    document.getElementById('result-dialog').style = 'display:none';
  }

  async function withErrorHandling(fn) {
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      ui.showResultDialog('Chyba', `Počas spracovania nastal problém. Detail:`, `${err.message}\n${err.stack}`);
    }
  }

  function showAccessRejectedDialog() {
    document.getElementById('access-rejected-dialog').style = '';
  }

  function hideAccessRejectedDialog() {
    document.getElementById('access-rejected-dialog').style = 'display:none';
  }

  function toggleAttribute(attrName, selectorOrNode, refNode = document) {
    const el = typeof selectorOrNode === 'string'
      ? refNode.querySelector(selectorOrNode)
      : selectorOrNode;
    const currentValue = el.getAttribute(attrName);
    const newValue = currentValue === 'true' ? 'false' : 'true';
    el.setAttribute(attrName, newValue);
  }

  /**
   * @param {Element} refNode
   * @param {string} closestSelector
   * @param {string} toggleSelector
   * @param {string} attrName
   * @param {string} focusSelector
   */
  async function toggleAndFocus(refNode, closestSelector, toggleSelector, attrName, focusSelector) {
    const closestNode = refNode.closest(closestSelector);

    const toggleNode = closestNode.querySelector(toggleSelector);
    const currentValue = toggleNode.getAttribute(attrName);
    const newValue = currentValue === 'true' ? 'false' : 'true';
    toggleNode.setAttribute(attrName, newValue);

    await new Promise(rs => setTimeout(rs, 100));
    const focusNode = closestNode.querySelector(focusSelector);
    const isFocusNodeDisplayed = window.getComputedStyle(focusNode).display !== 'none';
    if (isFocusNodeDisplayed) {
      focusNode.focus();
    }
  }

  return {
    createDownloadLink,
    revokeDownloadUrls,
    closeExportDialog,
    showResultDialog,
    closeResultDialog,
    withErrorHandling,
    showAccessRejectedDialog,
    hideAccessRejectedDialog,
    toggleAttribute,
    toggleAndFocus,
  }
})();
