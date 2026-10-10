const errorPanel = document.getElementById('startup-error');
const loading = document.getElementById('loading');
const surfaces = document.querySelectorAll('main, .site-header');
function setInert(inert) {
  surfaces.forEach((surface) => {
    surface.inert = inert;
  });
}
function showError() {
  loading.hidden = true;
  setInert(true);
  errorPanel.hidden = false;
  document.getElementById('startup-reload').focus();
}
function hideError() {
  errorPanel.hidden = true;
  setInert(false);
}
document.getElementById('startup-reload').addEventListener('click', () => location.reload());
window.addEventListener('structure-render-error', showError);
window.addEventListener('structure-render-restored', hideError);
// タイムアウト後に読み込みが終わった場合も、操作できる状態へ戻す
const timer = setTimeout(showError, 30000);
try {
  await import('./structure.js');
  if (!window.structureStudy?.snapshot().ready) throw new Error('3D rendering unavailable');
  hideError();
} catch {
  showError();
} finally {
  clearTimeout(timer);
}
