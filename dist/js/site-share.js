const input = document.querySelector('#share-url');
document.querySelector('#copy-link').addEventListener('click', async () => {
  const status = document.querySelector('#share-status');
  try {
    await navigator.clipboard.writeText(input.value);
    input.hidden = true;
    status.textContent = '共有URLをコピーしました。';
  } catch {
    input.hidden = false;
    input.focus();
    input.select();
    status.textContent = '表示されたURLをコピーしてください。';
  }
});

const resetKey = 'structure-jenga-reset-v1';
window.addEventListener('storage', (event) => {
  if (event.key === resetKey && event.newValue) location.reload();
});
document.querySelector('#clear-saved-data').addEventListener('click', () => {
  if (!confirm('このゲームの設定と記録を消しますか？ 同じゲームの他のタブも最初から開き直します。')) return;
  try {
    for (const key of [
      'structure-study-records-v3',
      'structure-selected-architecture-v1',
      'structure-audio-enabled-v1',
      'structure-audio-captions-v1',
      'structure-music-volume-v1',
    ])
      localStorage.removeItem(key);
    localStorage.setItem(resetKey, String(Date.now()));
    location.reload();
  } catch {
    document.querySelector('#share-status').textContent =
      '保存データを消せませんでした。ブラウザの設定を確認してください。';
  }
});
