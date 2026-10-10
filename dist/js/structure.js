import { CATALOG, makeStructure } from './structure-levels.js';
import { StructureGame, readRecords, saveRecord } from './structure-game.js';
import { StructureAudio } from './structure-audio.js';
import { StructureCaptions } from './structure-captions.js';
import { CHAPTERS } from './structure-stages.js';
import { StructureView } from './structure-view.js';
import { StructureCollapse } from './structure-collapse.js';
import { ARCHITECTURE_KEY, AUDIO_ENABLED_KEY, AUDIO_CAPTIONS_KEY, MUSIC_VOLUME_KEY } from './storage-keys.js';

const $ = (id) => document.getElementById(id);
const seedParam = new URLSearchParams(location.search).get('seed');
const roundOptions =
  seedParam !== null && /^\d{1,10}$/.test(seedParam) ? { seed: Number(seedParam) >>> 0 } : {};
function restoredArchitecture() {
  try {
    const saved = localStorage.getItem(ARCHITECTURE_KEY);
    return CATALOG.some(({ id }) => id === saved) ? saved : 'tetra';
  } catch {
    return 'tetra';
  }
}
const game = new StructureGame(restoredArchitecture(), roundOptions);
const audio = new StructureAudio();
const captions = new StructureCaptions();
try {
  const storedVolume = localStorage.getItem(MUSIC_VOLUME_KEY);
  if (storedVolume !== null) audio.setMusicVolume(Number(storedVolume));
  audio.enabled = localStorage.getItem(AUDIO_ENABLED_KEY) !== 'false';
  $('audio-captions').checked = localStorage.getItem(AUDIO_CAPTIONS_KEY) === 'true';
} catch {
  // Browser privacy settings can block localStorage.
}
function updateSoundButton() {
  $('sound-toggle').textContent = audio.enabled ? '♪' : '♪̸';
  $('sound-toggle').title = audio.enabled ? '音 ON' : '音 OFF';
  $('sound-toggle').setAttribute('aria-pressed', String(audio.enabled));
}
updateSoundButton();
$('music-volume').value = Math.round(audio.musicVolume * 100);
function updateMusicLabel() {
  const label = audio.musicVolume ? `${Math.round(audio.musicVolume * 100)}%` : 'OFF';
  $('music-volume-label').textContent = label;
  $('music-volume').setAttribute('aria-valuetext', label);
}
updateMusicLabel();
async function startAudio(event) {
  if (!audio.enabled || event.target.closest('#sound-toggle')) return;
  if (await audio.unlock()) {
    document.removeEventListener('pointerdown', startAudio);
    document.removeEventListener('keydown', startAudio);
  }
}
document.addEventListener('pointerdown', startAudio);
document.addEventListener('keydown', startAudio);
document.addEventListener('visibilitychange', () => audio.setVisible(!document.hidden));
window.addEventListener('pagehide', () => audio.setVisible(false));
window.addEventListener('pageshow', () => audio.setVisible(!document.hidden));
let view,
  selected = null,
  locked = false,
  generation = 0,
  pulse = null,
  collapsing = false,
  ready = false;
let saveResult = null;
let setupLevel = game.structure.id,
  setupChapter = game.structure.chapter,
  noticeTimer;
const wave = $('sound-wave').getContext('2d');
const memberName = (id) => `B-${String(id + 1).padStart(3, '0')}`;
const announce = (text) => {
  clearTimeout(noticeTimer);
  $('status').textContent = text;
  $('status').classList.toggle('visible', Boolean(text));
  if (text) noticeTimer = setTimeout(() => $('status').classList.remove('visible'), 3200);
};
function savePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    announce('設定は反映しましたが、次回用に保存できませんでした。');
  }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextStage = () => CATALOG[CATALOG.findIndex((level) => level.id === game.structure.id) + 1];

for (const chapter of CHAPTERS) {
  const button = document.createElement('button');
  button.textContent = chapter;
  button.dataset.chapter = chapter;
  button.setAttribute('aria-pressed', String(chapter === setupChapter));
  button.addEventListener('click', () => {
    setupChapter = chapter;
    updateSetup();
  });
  $('stage-chapters').append(button);
}

function preview(structure) {
  const points = structure.nodes.map(({ p }) => [p[0] + p[2] * 0.4, -p[1] + p[2] * 0.15]);
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const scale = Math.min(90 / (maxX - minX), 57 / (maxY - minY));
  const project = (i) =>
    `${(points[i][0] - (minX + maxX) / 2) * scale + 50},${(points[i][1] - (minY + maxY) / 2) * scale + 32}`;
  return `<svg viewBox="0 0 100 65" aria-hidden="true">${structure.members.map((m) => `<path d="M${project(m.a)}L${project(m.b)}" />`).join('')}</svg>`;
}
for (const level of CATALOG) {
  const button = document.createElement('button');
  button.className = 'exhibit';
  button.dataset.level = level.id;
  button.hidden = level.chapter !== setupChapter;
  button.setAttribute('aria-pressed', String(level.id === game.structure.id));
  button.innerHTML = `<span class="exhibit-number">${level.number}</span><span><strong>${level.name}</strong><small>${level.challenge}</small></span>${preview(makeStructure(level.id))}`;
  button.addEventListener('click', () => {
    setupLevel = level.id;
    updateSetup();
  });
  $('level-picker').append(button);
}

function records() {
  try {
    return readRecords(localStorage);
  } catch {
    return {};
  }
}
function update() {
  const s = game.stats;
  $('removed-count').textContent = s.count;
  $('target-count').textContent = game.structure.target;
  $('score').textContent = s.score.toLocaleString();
  $('target-label').textContent = s.cleared
    ? '目標達成。さらに余白をつくる？'
    : `${game.structure.target} 本抜こう。余分な棒も、一本。`;
  $('target-progress').textContent = `${s.count} / ${game.structure.target}`;
  $('target-bar').style.width = `${Math.min(100, (s.count / game.structure.target) * 100)}%`;
  $('records-open').title = `${s.count} 本 / 目標 ${game.structure.target} 本 · 詳しい記録`;
  $('records-open').setAttribute(
    'aria-label',
    `${s.count} / ${game.structure.target} 本 ${s.score}pt、詳しい記録を見る`,
  );
  $('reduction').textContent = `${Math.round(s.reduction * 100)}%`;
  $('empty-count').textContent = `${s.empty} 本`;
  $('collection-count').textContent = `${s.count} pieces`;
  $('best-score').textContent = records()[game.structure.id]?.score ?? '—';
  $('beam-tray').replaceChildren();
  for (const entry of game.history) {
    const bar = document.createElement('span');
    bar.className = `tray-beam${entry.pending ? ' pending' : !entry.stable ? ' failed' : entry.meaningful ? '' : ' empty'}`;
    bar.title = `${memberName(entry.id)} / ${entry.pending ? '揺れを見守っています' : entry.stable ? `+${entry.points}点` : '崩壊'}`;
    bar.setAttribute('aria-label', bar.title);
    $('beam-tray').append(bar);
  }
  if (!game.history.length)
    $('beam-tray').innerHTML = '<span class="tray-empty">ここに、あなたの選択が並びます。</span>';
  const canAct = ready && !locked && game.status === 'playing';
  const member = selected === null ? null : game.result.members.get(selected);
  for (const id of ['help-open', 'settings-open', 'structure-open', 'records-open', 'result-open'])
    $(id).disabled = collapsing;
  $('selected-name').textContent = member ? memberName(selected) : '未選択';
  $('selected-kind').textContent = member
    ? view.meshes.get(selected)?.userData.profile.column
      ? '石の柱'
      : '木の梁'
    : '';
  const candidates = view?.candidates ?? [];
  const candidateLabel = `${candidates.indexOf(selected) + 1} / ${candidates.length}`;
  $('cycle-member').hidden = !member || candidates.length < 2;
  $('cycle-member').disabled = !canAct;
  $('candidate-position').textContent = candidateLabel;
  $('cycle-member').setAttribute('aria-label', `近くの別の部材を選ぶ。候補 ${candidateLabel}`);
  $('sound-wave').hidden = candidates.length > 1;
  if (view) view.interactive = canAct;
  const hideDock = !member || game.status !== 'playing';
  if (hideDock && $('selection-dock').contains(document.activeElement))
    $('structure-viewport').focus({ preventScroll: true });
  $('selection-dock').hidden = hideDock;
  $('sound-cue').hidden = hideDock;
  $('audio-description').hidden = hideDock || !$('audio-captions').checked;
  $('probe').disabled = $('extract').disabled = !canAct || !member;
  $('finish').disabled = !canAct || s.count === 0;
  $('finish').hidden = s.count === 0 || game.status !== 'playing';
  $('ended-actions').hidden = game.status === 'playing' || locked;
  $('settling').hidden = !locked || game.status !== 'playing';
  $('settling-label').textContent = game.finishing
    ? 'もうひと揺れ、持ちこたえたら。'
    : 'まだ、揺れが戻ってくるかも。';
  $('session-label').textContent = '自重と、かすかな揺れ';
  $('stage-number').textContent = `${game.structure.number} / ${CATALOG.length}`;
  $('round-tag').textContent = `${game.structure.number} / ${game.structure.name}`;
  $('stage-name').textContent = game.structure.name;
  const canAdvance = game.status === 'finished' && s.cleared && Boolean(nextStage());
  $('next-stage').hidden = $('result-next').hidden = !canAdvance;
  if (canAdvance) $('result-next').textContent = `次へ · ${nextStage().name} →`;
  $('stage-hint').hidden = Boolean(member) || locked;
  $('piece-guide').hidden = Boolean(member) || locked || game.status !== 'playing' || game.probes > 0;
  $('stage-hint').textContent =
    game.status === 'finished'
      ? '少なくなっても、まだ立っている。'
      : game.status === 'collapsed'
        ? 'その一本が、境目だった。'
        : s.cleared
          ? '目標達成。もう一本か、ここで完成か。'
          : game.probes
            ? '次の一本に、耳をすます。'
            : game.structure.id === 'tetra'
              ? 'まずは足もとの、余分そうな一本を。'
              : game.structure.chapter === CHAPTERS[0]
                ? '柱も梁も、一本ずつ抜ける。'
                : '柱も梁も一本ずつ。地面の部材は固定。';
}

function updateSetup() {
  document
    .querySelectorAll('[data-chapter]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.chapter === setupChapter)),
    );
  document.querySelectorAll('[data-level]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.level === setupLevel));
    button.hidden = CATALOG.find((level) => level.id === button.dataset.level).chapter !== setupChapter;
  });
  $('setup-apply').textContent = `${CATALOG.find((level) => level.id === setupLevel).name} を始める ↗`;
}
function openSetup() {
  setupLevel = game.structure.id;
  setupChapter = game.structure.chapter;
  updateSetup();
  $('settings-dialog').showModal();
  $('setup-content').scrollTop = 0;
}

async function select(id, candidates = []) {
  const member = game.result.members.get(id);
  if (!ready || locked || game.status !== 'playing' || !member || member.foundation) return;
  selected = id;
  $('sound-impression').textContent = '耳をすませて…';
  $('view-menu').open = false;
  view.select(id, candidates);
  update();
  await probe();
}
async function probe() {
  if (selected === null || locked || game.status !== 'playing') return;
  captions.cancel();
  const token = generation,
    id = selected,
    attempt = captions.sequence;
  if (!game.result.members.has(id)) return;
  const unlocked = await audio.unlock();
  if (
    token !== generation ||
    id !== selected ||
    attempt !== captions.sequence ||
    locked ||
    game.status !== 'playing'
  )
    return;
  const member = game.probe(id);
  if (!member) return;
  const target = view.targets().find((target) => target.id === id);
  const profile = audio.strike(
    member,
    target ? (target.x / $('structure-viewport').clientWidth) * 1.6 - 0.8 : 0,
  );
  pulse = { ...profile, time: performance.now() / 1000 };
  view.ping(id);
  const showCaption = (caption) => {
    if (token !== generation || id !== selected || locked || game.status !== 'playing') return;
    $('sound-impression').textContent = caption.text;
    $('sound-impression').dataset.source = caption.source;
    $('sound-impression').dataset.band = caption.band;
  };
  showCaption(captions.describe(profile));
  $('audio-description').textContent =
    profile.grip > 0.4
      ? '短く乾いた音。荷重が掛かって、動きにくいような印象。'
      : '少し響きが残る音。小突くと遊びがあるような印象。';
  if (!unlocked) announce('音を開始できません。「アーキテクチャを選ぶ」から音の文字表示をONにできます。');
  else if (!audio.enabled) announce('音はOFFです。上部の音ボタンでONにできます。');
  else announce('');
  update();
}
async function extract() {
  if (selected === null || locked || game.status !== 'playing') return;
  const id = selected;
  captions.cancel();
  const event = game.remove(id);
  if (!event) {
    update();
    return;
  }
  locked = true;
  void audio.unlock();
  selected = null;
  audio.cancelProbe();
  pulse = null;
  $('audio-description').textContent = '';
  view.extract(id, event.after, game.status === 'collapsed');
  audio.remove();
  update();
  if (game.status === 'collapsed') {
    await onCollapse();
    return;
  }
  announce('抜けた。まだ、揺れを見届けよう。');
}
async function onCollapse() {
  const token = generation;
  captions.cancel();
  locked = true;
  selected = null;
  audio.cancelProbe();
  pulse = null;
  view.select(null);
  if (!view.failure) view.collapse(game.result);
  announce('');
  audio.collapse();
  collapsing = true;
  update();
  await delay(view.reducedMotion ? 1400 : 5200);
  if (token !== generation) return;
  collapsing = false;
  locked = false;
  closeDialogs();
  showResult();
}
function handleMotion(events) {
  for (const event of events) {
    if (event.type === 'collapsed') {
      void onCollapse();
    } else if (event.type === 'settled') {
      locked = false;
      update();
      announce(
        event.heldOn
          ? `…踏ん張った。+${event.entry.points}点。`
          : `${memberName(event.entry.id)}、持ちこたえた。+${event.entry.points}点。`,
      );
    } else if (event.type === 'recovered') {
      announce('…揺れが戻った。まだ、立っている。');
    } else if (event.type === 'finished') {
      locked = false;
      audio.success();
      showResult();
    }
  }
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}
function restart(level = game.structure.id) {
  if (!ready) return;
  generation++;
  captions.cancel();
  audio.cancelProbe();
  closeDialogs();
  collapsing = false;
  locked = false;
  selected = null;
  pulse = null;
  saveResult = null;
  audio.cancelCollapse();
  game.reset(level, roundOptions);
  view.load(game.structure, game.result);
  $('original-toggle').setAttribute('aria-pressed', 'false');
  $('audio-description').textContent = '';
  announce('');
  try {
    localStorage.setItem(ARCHITECTURE_KEY, game.structure.id);
  } catch {
    announce('このブラウザでは、選んだアーキテクチャを保存できませんでした。');
  }
  update();
  $('structure-viewport').focus({ preventScroll: true });
}
function showResult() {
  if (!saveResult) {
    try {
      saveResult = saveRecord(localStorage, game);
    } catch {
      saveResult = { saved: false, best: false };
    }
  }
  const s = game.stats,
    finished = game.status === 'finished';
  $('result-eyebrow').textContent = finished ? 'LESS, AND STILL STANDING.' : 'EVERY FALL TELLS A STORY.';
  $('result-title').textContent = finished
    ? s.cleared
      ? 'この余白が、あなたの作品。'
      : '小さな余白も、ひとつの作品。'
    : 'その一本が、境目だった。';
  $('result-copy').textContent = finished
    ? `${game.structure.name}は、${s.count}本少なくなっても立っています。`
    : `${s.count}本まで、立っていました。崩れ方を眺めて、次の一本へ。`;
  $('result-score').textContent = s.score.toLocaleString();
  $('result-count').textContent = `${s.count}本`;
  $('result-reduction').textContent = `${Math.round(s.reduction * 100)}%`;
  $('result-detail').textContent =
    `${s.count} / ${game.structure.target}本 · 荷重ボーナス ${s.useful}本${finished ? ` / 完成ボーナス +${s.finishBonus}` : ' / 崩壊した一本は加点されません'}`;
  $('save-status').textContent = !saveResult.saved
    ? '記録を保存できませんでした。この画面で結果を確認できます。'
    : saveResult.best
      ? 'NEW BEST · このブラウザに記録しました。'
      : 'このブラウザに自己ベストを保存しています。';
  $('result-view').textContent = finished ? '作品を見る' : '崩れたかたちを見る';
  $('result-replay').hidden = finished;
  update();
  $('result-dialog').showModal();
}
function drawWave(time) {
  const width = wave.canvas.width,
    height = wave.canvas.height;
  wave.clearRect(0, 0, width, height);
  wave.strokeStyle = '#bec9b6';
  wave.lineWidth = 1;
  wave.beginPath();
  wave.moveTo(0, height / 2);
  wave.lineTo(width, height / 2);
  wave.stroke();
  const elapsed = pulse ? time - pulse.time : 10;
  const voice = pulse;
  if (pulse && elapsed < 2.8) {
    wave.strokeStyle = '#6e8760';
    wave.lineWidth = 1.6;
    wave.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const envelope = Math.sin((Math.PI * x) / width) ** 2 * Math.exp(-elapsed / Math.max(0.2, voice.decay));
      const value =
        Math.sin((x * voice.frequency) / 3700 + elapsed * 13) + Math.sin(x * 0.12 - elapsed * 9) * 0.25;
      const y = height / 2 + value * envelope * 35;
      if (x === 0) wave.moveTo(x, y);
      else wave.lineTo(x, y);
    }
    wave.stroke();
  } else {
    wave.fillStyle = '#bac6b0';
    for (let x = 10; x < width; x += 13) wave.fillRect(x, height / 2 - 2, 2, 4);
  }
}

$('probe').addEventListener('click', probe);
$('cycle-member').addEventListener('click', () => view?.cycleCandidate());
$('extract').addEventListener('click', extract);
$('deselect').addEventListener('click', () => {
  captions.cancel();
  audio.cancelProbe();
  selected = null;
  view.select(null);
  update();
});
$('settings-open').addEventListener('click', openSetup);
$('structure-open').addEventListener('click', openSetup);
$('records-open').addEventListener('click', () => $('records-dialog').showModal());
$('setup-apply').addEventListener('click', () => {
  if (game.status === 'playing' && game.history.length && !confirm('いまの挑戦をやめて始めますか？')) return;
  restart(setupLevel);
});
$('result-open').addEventListener('click', showResult);
$('restart').addEventListener('click', () => restart());
for (const id of ['next-stage', 'result-next'])
  $(id).addEventListener('click', () => {
    if (game.status === 'finished' && game.stats.cleared && nextStage()) restart(nextStage().id);
  });
$('result-retry').addEventListener('click', () => restart());
$('result-view').addEventListener('click', () => $('result-dialog').close());
$('result-replay').addEventListener('click', () => {
  $('result-dialog').close();
  view.replay();
  audio.collapse();
});
$('finish').addEventListener('click', () => {
  if (locked || !game.finish()) return;
  captions.cancel();
  selected = null;
  audio.cancelProbe();
  view.select(null);
  locked = true;
  announce('完成の前に、もうひと揺れ。');
  update();
  $('structure-viewport').focus({ preventScroll: true });
});
$('sound-toggle').addEventListener('click', async () => {
  const enabled = audio.toggle();
  updateSoundButton();
  savePreference(AUDIO_ENABLED_KEY, enabled);
  if (enabled) await audio.unlock();
});
$('audio-captions').addEventListener('change', () => {
  savePreference(AUDIO_CAPTIONS_KEY, $('audio-captions').checked);
  update();
});
$('music-volume').addEventListener('input', () => {
  audio.setMusicVolume(Number($('music-volume').value) / 100);
  updateMusicLabel();
  savePreference(MUSIC_VOLUME_KEY, audio.musicVolume);
});
$('members-toggle').addEventListener('click', () => {
  if (!view) return;
  view.showMembers = !view.showMembers;
  $('members-toggle').setAttribute('aria-pressed', String(view.showMembers));
});
$('original-toggle').addEventListener('click', () => {
  if (!view) return;
  view.showOriginal = !view.showOriginal;
  $('original-toggle').setAttribute('aria-pressed', String(view.showOriginal));
});
$('view-left').addEventListener('click', () => view?.rotate(-Math.PI / 6));
$('view-right').addEventListener('click', () => view?.rotate(Math.PI / 6));
$('view-home').addEventListener('click', () => view?.home());
$('view-in').addEventListener('click', () => view?.zoom(0.85));
$('view-out').addEventListener('click', () => view?.zoom(1.18));
$('help-open').addEventListener('click', () => $('help-dialog').showModal());
document
  .querySelectorAll('[data-close]')
  .forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
document.addEventListener('keydown', (event) => {
  if (!ready || event.target.matches('input,select,textarea') || document.querySelector('dialog[open]'))
    return;
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'KeyR') {
    event.preventDefault();
    if (game.status !== 'playing' || !game.history.length || confirm('最初からやり直しますか？')) restart();
  }
  if (event.code === 'KeyM') $('sound-toggle').click();
  if (event.target !== $('structure-viewport')) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
    event.preventDefault();
    const ids = [...game.result.members.values()].filter((m) => !m.foundation).map((m) => m.id);
    const index = ids.indexOf(selected);
    const offset = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
    if (ids.length) select(ids[(index + offset + ids.length) % ids.length]);
  }
  if (event.code === 'Space') {
    event.preventDefault();
    probe();
  }
  if (event.code === 'KeyX') {
    event.preventDefault();
    extract();
  }
});

try {
  await StructureCollapse.init();
  view = new StructureView($('structure-viewport'), select, (impact) => {
    try {
      audio.impact(impact);
    } catch (error) {
      console.error(error);
    }
  });
  view.onFoundation = () => announce('地面に据えた部材は、初級から抜けません。');
  view.load(game.structure, game.result);
  ready = true;
  $('loading').hidden = true;
  update();
  view.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    $('loading').textContent = '3D描画が中断されました。ページを再読み込みしてください。';
    $('loading').hidden = false;
    update();
    window.dispatchEvent(new Event('structure-render-error'));
  });
  view.renderer.domElement.addEventListener('webglcontextrestored', () => {
    ready = true;
    $('loading').hidden = true;
    update();
    window.dispatchEvent(new Event('structure-render-restored'));
  });
  let previousFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    requestAnimationFrame(frame);
    if (!ready || document.hidden) return;
    try {
      const paused = Boolean(document.querySelector('dialog[open]'));
      if (!paused && game.status === 'playing') {
        handleMotion(game.advance(dt));
        if (game.status === 'playing') view.followAnalysis(game.result, game.sway);
      }
      view.frame(now / 1000);
      drawWave(now / 1000);
    } catch (error) {
      ready = false;
      $('loading').textContent = '3D描画でエラーが起きました。ページを再読み込みしてください。';
      $('loading').hidden = false;
      update();
      console.error(error);
      window.dispatchEvent(new Event('structure-render-error'));
    }
  }
  requestAnimationFrame(frame);
} catch (error) {
  $('loading').textContent =
    '3D描画を開始できませんでした。WebGL対応ブラウザで、ハードウェアアクセラレーションを有効にして開いてください。';
  announce('3D描画の初期化に失敗しました。');
  console.error(error);
}

window.structureStudy = {
  snapshot: () => ({
    ready,
    level: game.structure.id,
    seed: game.seed,
    motion: {
      time: game.time,
      sway: [...game.sway],
      displacement: game.result.maxDisplacement,
      pending: Boolean(game.pending),
      finishing: game.finishing,
      overload: game.overload,
      delayedFailure: game.failure?.delayed ?? false,
    },
    status: game.status,
    selected,
    selectionCandidates: [...(view?.candidates ?? [])],
    locked,
    stats: game.stats,
    probes: game.probes,
    members: game.structure.members.length,
    removed: [...game.removed],
    audio: {
      state: audio.context?.state ?? 'locked',
      events: audio.events,
      enabled: audio.enabled,
      voices: audio.voices,
      crashEvents: audio.crashEvents,
      floorEvents: audio.floorEvents,
      music: audio.music?.snapshot ?? {
        playing: false,
        volume: audio.musicVolume,
        notes: 0,
        voices: 0,
      },
      grip: pulse?.grip ?? null,
      cue: $('sound-impression').textContent,
      captions: {
        status: captions.status,
        source: $('sound-impression').dataset.source ?? null,
        band: $('sound-impression').dataset.band ?? null,
      },
    },
    targets: view?.targets() ?? [],
    history: game.history.map((entry) => ({ ...entry })),
    collapse: view?.collapseStats() ?? null,
    rendering: view
      ? {
          calls: view.renderer.info.render.calls,
          triangles: view.renderer.info.render.triangles,
          instancedBeams: view.beamBatch?.count ?? 0,
          instancedJoints: view.jointBatch?.count ?? 0,
          cameraDistance: view.camera.position.distanceTo(view.controls.target),
          fogNear: view.scene.fog.near,
          memberHighlight: view.affordance.focus.visible ? (view.selected ?? view.hovered) : null,
          membersVisible: view.affordance.all?.visible ?? false,
        }
      : null,
  }),
};
