const errorPanel = document.getElementById('startup-error');
const loading = document.getElementById('loading');
const surfaces = document.querySelectorAll('main, .site-header');
let timer;
function showError() {
  loading.hidden = true;
  surfaces.forEach((surface) => {
    surface.inert = true;
  });
  errorPanel.hidden = false;
  document.getElementById('startup-reload').focus();
}
document.getElementById('startup-reload').addEventListener('click', () => location.reload());
window.addEventListener('structure-render-error', showError);
try {
  await Promise.race([
    import('./structure.js'),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Startup timed out')), 30000);
    }),
  ]);
  if (!window.structureStudy?.snapshot().ready) throw new Error('3D rendering unavailable');
  surfaces.forEach((surface) => {
    surface.inert = false;
  });
} catch {
  showError();
} finally {
  clearTimeout(timer);
}
