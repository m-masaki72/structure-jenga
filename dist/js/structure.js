import { CATALOG, makeStructure, dailyLevel, levelById } from './structure-levels.js';
import {
  StructureGame,
  readRecords,
  saveRecord,
  recordKey,
  recordCleared,
  LIMIT_RULES,
} from './structure-game.js';
import { StructureAudio } from './structure-audio.js';
import { StructureCaptions } from './structure-captions.js';
import { CHAPTERS } from './structure-stages.js';
import { StructureView } from './structure-view.js';
import { dailySeed, jstDay } from './structure-motion.js';
import { rankingEnabled, fetchBoard, submitScore } from './ranking.js';
import {
  ARCHITECTURE_KEY,
  AUDIO_ENABLED_KEY,
  AUDIO_CAPTIONS_KEY,
  MUSIC_VOLUME_KEY,
  NICKNAME_KEY,
  TIPS_KEY,
} from './storage-keys.js';

const $ = (id) => document.getElementById(id);
const seedParam = new URLSearchParams(location.search).get('seed');
const fixedSeed = seedParam !== null && /^\d{1,10}$/.test(seedParam) ? Number(seedParam) >>> 0 : null;
function restoredArchitecture() {
  try {
    const saved = localStorage.getItem(ARCHITECTURE_KEY);
    return CATALOG.some(({ id }) => id === saved) ? saved : 'tetra';
  } catch {
    return 'tetra';
  }
}
// 再訪時はいつもステージ（ふつうモード）から。限界モードは「今日の限界」から毎回入る
let mode = 'classic',
  roundDay = jstDay();
// 限界モードは日替わりの共通シード（?seed= があればそちらを優先。ただしランキングには送れない）
function roundOptions(level) {
  roundDay = jstDay();
  if (mode === 'limit') return { mode, seed: fixedSeed ?? dailySeed(roundDay, level) };
  return fixedSeed === null ? {} : { seed: fixedSeed };
}
const game = new StructureGame(restoredArchitecture(), roundOptions(restoredArchitecture()));
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
  $('sound-open').textContent = audio.enabled ? '♪' : '♪̸';
  $('sound-open').title = `音の設定（いまは${audio.enabled ? 'ON' : 'OFF'}）`;
  $('sound-open').setAttribute('aria-label', $('sound-open').title);
  $('sound-state').textContent = audio.enabled ? 'ON' : 'OFF';
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
  // 限界モードの開始前カウントダウン（残り秒）。0 になるまで時計を止め、操作も受け付けない
  countdown = 0,
  generation = 0,
  pulse = null,
  collapsing = false,
  ready = false;
let saveResult = null;
let settingsTab = 'stages',
  noticeTimer;
let board = null,
  boardTab = 'daily',
  submitted = false;
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
const previews = new Map(CATALOG.map((level) => [level.id, preview(makeStructure(level.id))]));
function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}
// ステージは章ごとの見出しの下に全部並べ、押したらすぐ始める
for (const chapter of CHAPTERS) {
  const group = element('section', 'stage-group');
  const heading = element('h3');
  heading.dataset.chapter = chapter;
  group.append(heading);
  for (const level of CATALOG.filter((level) => level.chapter === chapter)) {
    const button = element('button', 'stage-row');
    button.dataset.level = level.id;
    const text = element('span', 'stage-row-text');
    text.append(
      element('strong', '', level.name),
      element('small', '', `${level.challenge} · 目標 ${level.target}本`),
    );
    button.append(element('span', 'level-number', level.number), text, element('span', 'stage-row-status'));
    button.insertAdjacentHTML('beforeend', previews.get(level.id));
    button.addEventListener('click', () => startRound(level.id, 'classic'));
    group.append(button);
  }
  $('level-picker').append(group);
}

// ステージと今日の限界の違い（「構造を選ぶ」と「遊び方」の両方に出す）
const MODE_COMPARE = [
  ['構造', '20の構造から選ぶ', '毎日ひとつ。全員が同じ組み付けと揺れ'],
  [
    '時間',
    '無制限。メニューを開くと止まる',
    `目標本数×${LIMIT_RULES.secondsPerTarget}秒。メニューを開いても止まらない`,
  ],
  ['揺れ', 'かすかな揺れが続く', 'だんだん強まる'],
  [
    '得点',
    '目標の本数を抜いて「ここで完成」でボーナス',
    `荷重を受けていた棒ほど高得点。ぎりぎりの一本は×${LIMIT_RULES.edgeMultiplier}、早めの完成は残り時間ボーナス`,
  ],
  ['崩れたら', '崩れた一本は加点なし', `合計の${Math.round((1 - LIMIT_RULES.collapseKeep) * 100)}%を失う`],
  ['記録', 'このブラウザに自己ベスト', '日替わりランキングに送れる'],
];
for (const id of ['daily-compare', 'help-compare']) {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const text of ['', 'ステージ', '今日の限界']) {
    const cell = element('th', '', text);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const [label, classic, limit] of MODE_COMPARE) {
    const row = body.insertRow();
    const cell = element('th', '', label);
    cell.scope = 'row';
    row.append(cell);
    row.insertCell().textContent = classic;
    row.insertCell().textContent = limit;
  }
  $(id).append(table);
}

// 最初のガイドと、新しいルールが初めて出てきたときの一度きりのヒント
const tips = new Set();
try {
  for (const name of JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]')) tips.add(name);
} catch {
  // 保存できない環境では、毎回ガイドが出る
}
const saveTips = () => savePreference(TIPS_KEY, JSON.stringify([...tips]));
function markTip(name) {
  if (tips.has(name)) return;
  tips.add(name);
  saveTips();
}
// 01 をもうクリアしている人には、最初のガイドを出さない
if (recordCleared(records()[CATALOG[0].id], CATALOG[0].target)) tips.add('guide');
let coach = null;
const GUIDE_STEPS = 4;
function nextCoach() {
  const s = game.stats,
    playing = game.status === 'playing';
  if (game.mode === 'classic' && game.structure.id === CATALOG[0].id && !tips.has('guide')) {
    const step = (number, text, target) => ({ name: 'guide', step: number, text, target });
    if (game.status === 'collapsed')
      return step(null, '崩れても大丈夫。崩れる前に抜けた本数の点は残ります。「もう一度」で組み直せます。');
    if (!playing) return null;
    if (locked) return step(3, '抜いたあと数秒は、揺れで遅れて崩れることがあります。収まるまで見届けて。');
    if (s.cleared)
      return step(
        4,
        `目標の${game.structure.target}本を達成。さらに抜くと高得点、でも崩れたら…。「ここで完成」で記録が決まります。`,
        'finish',
      );
    if (selected !== null)
      return step(
        2,
        'コツッと詰まる音は、荷重を受けて突っ張っていそう。カラッと響くなら遊びがありそう。決めたら「一本抜く」。',
        'extract',
      );
    if (s.count)
      return step(3, `持ちこたえた。あと${game.structure.target - s.count}本。次の一本も、聴いてから。`);
    return step(1, '石や木の部材をタップして選ぶ。選ぶと、小突いた音が鳴ります。');
  }
  if (!playing || locked) return null;
  if (!tips.has('foundation') && game.structure.chapter !== CHAPTERS[0] && !game.history.length)
    return { name: 'foundation', text: '初級からは、両端が地面についた暗い部材は土台。抜けません。' };
  if (!tips.has('cycle') && selected !== null && (view?.candidates.length ?? 0) > 1)
    return {
      name: 'cycle',
      text: '部材が重なった場所です。「↻」で近くの別の部材に切り替えられます。',
      target: 'cycle-member',
    };
  return null;
}
function updateCoach() {
  const next = nextCoach();
  // ヒントは閉じるか、場面が変わって消えたら既読にする（ガイドは最後まで遊ぶか閉じたときだけ）
  if (coach && coach.name !== 'guide' && coach.name !== next?.name) markTip(coach.name);
  coach = next;
  $('coach').hidden = !coach;
  document.querySelectorAll('.coach-target').forEach((node) => node.classList.remove('coach-target'));
  if (!coach) return;
  $('coach-step').textContent = coach.step
    ? `${coach.step} / ${GUIDE_STEPS}`
    : coach.name === 'guide'
      ? ''
      : 'ヒント';
  $('coach-text').textContent = coach.text;
  $('coach-close').textContent = coach.name === 'guide' ? 'ガイドを閉じる' : 'わかった';
  if (coach.target) $(coach.target).classList.add('coach-target');
}

function records() {
  try {
    return readRecords(localStorage);
  } catch {
    return {};
  }
}
function updateTimer() {
  const limit = game.mode === 'limit';
  $('limit-timer').hidden = !limit;
  $('records-open').classList.toggle('limit', limit);
  if (!limit) return;
  const left = game.timeLeft;
  $('time-left').textContent = left.toFixed(1);
  $('target-bar').style.width = `${(left / game.timeLimit) * 100}%`;
  $('records-open').classList.toggle('urgent', game.status === 'playing' && left < 10);
}
// 残り秒を 3・2・1 で見せ、0 になったら操作できる状態へ表示を戻す
function updateCountdown() {
  const shown = countdown ? String(Math.ceil(countdown)) : '';
  if ($('countdown').textContent === shown) return;
  $('countdown').textContent = shown;
  $('countdown').hidden = !shown;
  if (!shown) update();
}
function update() {
  const s = game.stats,
    limit = game.mode === 'limit';
  $('removed-count').textContent = s.count;
  $('target-count').textContent = game.structure.target;
  $('score').textContent = s.score.toLocaleString();
  $('target-label').textContent = limit
    ? `${Math.round(game.timeLimit)} 秒で、限界まで。`
    : s.cleared
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
  $('best-score').textContent = records()[recordKey(game.structure.id, game.mode)]?.score ?? '—';
  $('record-note').textContent = limit
    ? `荷重を受けていた棒ほど高得点、ぎりぎりの一本は×${LIMIT_RULES.edgeMultiplier}。崩れると合計の${Math.round((1 - LIMIT_RULES.collapseKeep) * 100)}%を失います。`
    : '抜けた棒はすべて50点以上。荷重を受けていた棒には追加点。完成させると、ボーナスが入ります。';
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
  const canAct = ready && !locked && !countdown && game.status === 'playing';
  const member = selected === null ? null : game.result.members.get(selected);
  for (const id of [
    'help-open',
    'settings-open',
    'daily-open',
    'structure-open',
    'records-open',
    'result-open',
  ])
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
  $('session-label').textContent = limit ? '今日の限界 · 揺れが強まっていく' : '自重と、かすかな揺れ';
  $('stage-number').textContent = limit ? roundDay : `${game.structure.number} / ${CATALOG.length}`;
  $('round-tag').textContent =
    `${game.structure.number} / ${game.structure.name}${limit ? ` · 今日の限界 ${roundDay}` : ''}`;
  $('stage-name').textContent = game.structure.name;
  const canAdvance = !limit && game.status === 'finished' && s.cleared && Boolean(nextStage());
  $('next-stage').hidden = $('result-next').hidden = !canAdvance;
  if (canAdvance) $('result-next').textContent = `次へ · ${nextStage().name} →`;
  updateCoach();
  const guiding = coach?.name === 'guide';
  $('stage-hint').hidden = Boolean(member) || locked || guiding;
  $('piece-guide').hidden =
    Boolean(member) || locked || guiding || game.status !== 'playing' || game.probes > 0;
  $('stage-hint').textContent =
    game.status === 'finished'
      ? '少なくなっても、まだ立っている。'
      : game.status === 'collapsed'
        ? 'その一本が、境目だった。'
        : limit
          ? '揺れは強まる。きわどい一本ほど高得点。'
          : s.cleared
            ? '目標達成。もう一本か、ここで完成か。'
            : game.probes
              ? '次の一本に、耳をすます。'
              : game.structure.id === 'tetra'
                ? 'まずは足もとの、余分そうな一本を。'
                : game.structure.chapter === CHAPTERS[0]
                  ? '柱も梁も、一本ずつ抜ける。'
                  : '柱も梁も一本ずつ。地面の部材は固定。';
  updateTimer();
}

function renderStages() {
  const saved = records();
  const cleared = (level) => recordCleared(saved[level.id], level.target);
  const next = CATALOG.find((level) => !cleared(level));
  for (const row of document.querySelectorAll('.stage-row')) {
    const level = levelById(row.dataset.level),
      record = saved[level.id];
    const current = game.mode === 'classic' && level.id === game.structure.id;
    row.classList.toggle('cleared', cleared(level));
    row.classList.toggle('next', level === next);
    if (current) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
    row.querySelector('.stage-row-status').textContent = cleared(level)
      ? `✓ ${record.score.toLocaleString()}pt`
      : record
        ? `${record.score.toLocaleString()}pt`
        : level === next
          ? 'つぎ'
          : '';
  }
  for (const heading of document.querySelectorAll('.stage-group h3')) {
    const levels = CATALOG.filter((level) => level.chapter === heading.dataset.chapter);
    heading.replaceChildren(
      heading.dataset.chapter,
      element('small', '', `${levels.filter(cleared).length} / ${levels.length}`),
    );
  }
  $('continue-stage').hidden = !next;
  if (next)
    $('continue-stage').replaceChildren(
      element('small', '', 'つづきから'),
      element('strong', '', `${next.number} ${next.name}`),
      element('span', '', `目標 ${next.target}本 ↗`),
    );
  $('continue-stage').dataset.level = next?.id ?? '';
}
function untilTomorrow(day) {
  const minutes = Math.ceil((Date.parse(`${day}T00:00:00+09:00`) + 86400e3 - Date.now()) / 60e3);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : `${minutes}分`;
}
function boardItems(rows, label, emptyText) {
  const items = rows.map((row, index) => {
    const item = element('li');
    item.append(
      element('span', '', index + 1),
      element('span', '', label(row)),
      element('b', '', row.score.toLocaleString()),
    );
    return item;
  });
  return items.length ? items : [element('li', 'empty', emptyText)];
}
let dailyBoardKey = null;
async function renderDaily() {
  const day = jstDay(),
    level = levelById(dailyLevel(day)),
    key = `${level.id}:${day}`;
  $('daily-date').textContent = `${day} の構造 · ${level.chapter}`;
  $('daily-name').textContent = level.name;
  // 項目の途中で折り返さないよう、一項目ずつ包む
  $('daily-meta').replaceChildren(
    ...[
      `持ち時間 ${level.target * LIMIT_RULES.secondsPerTarget}秒`,
      `目安 ${level.target}本`,
      `自己ベスト ${records()[recordKey(level.id, 'limit')]?.score?.toLocaleString() ?? '—'}`,
    ].map((item) => Object.assign(document.createElement('span'), { textContent: item })),
  );
  $('daily-preview').replaceChildren();
  $('daily-preview').insertAdjacentHTML('beforeend', previews.get(level.id));
  $('daily-reset').textContent = `次の構造まで、あと${untilTomorrow(day)}。`;
  $('daily-ranking').hidden = !rankingEnabled;
  if (!rankingEnabled || dailyBoardKey === key) return;
  dailyBoardKey = key;
  $('daily-board').replaceChildren(element('li', 'empty', '読み込み中…'));
  $('daily-mine').textContent = '';
  try {
    const result = await fetchBoard(level.id, day);
    if (dailyBoardKey !== key) return;
    $('daily-board').replaceChildren(
      ...boardItems(
        result.daily.slice(0, 5),
        (row) => row.name,
        'まだ掲載された記録はありません。一番乗りのチャンス。',
      ),
    );
    const mine = result.mine?.filter((row) => row.status === 'verified').map((row) => row.score) ?? [];
    $('daily-mine').textContent = mine.length
      ? `自分の今日のベスト：${Math.max(...mine).toLocaleString()}pt`
      : '';
  } catch (error) {
    if (dailyBoardKey !== key) return;
    dailyBoardKey = null;
    $('daily-board').replaceChildren(
      element('li', 'empty', `ランキングを読み込めませんでした（${error.message}）。`),
    );
  }
}
function showTab(tab) {
  settingsTab = tab;
  for (const name of ['stages', 'daily']) {
    const active = name === tab;
    $(`tab-${name}`).setAttribute('aria-selected', String(active));
    $(`tab-${name}`).tabIndex = active ? 0 : -1;
    $(`panel-${name}`).hidden = !active;
  }
  $('daily-footer').hidden = tab !== 'daily';
  if (tab === 'daily') void renderDaily();
  else renderStages();
  $('settings-content').scrollTop = 0;
}
function openSettings(tab = game.mode === 'limit' ? 'daily' : 'stages') {
  showTab(tab);
  $('settings-dialog').showModal();
}
function startRound(level, nextMode) {
  if (game.status === 'playing' && game.history.length && !confirm('いまの挑戦をやめて始めますか？')) return;
  mode = nextMode;
  restart(level);
}

async function select(id, candidates = []) {
  const member = game.result.members.get(id);
  if (!ready || locked || countdown || game.status !== 'playing' || !member || member.foundation) return;
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
  if (!unlocked) announce('音を開始できません。上部の「♪」から音の文字表示をONにできます。');
  else if (!audio.enabled) announce('音はOFFです。上部の「♪」でONにできます。');
  else announce('');
  update();
}
async function extract() {
  if (selected === null || locked || countdown || game.status !== 'playing') return;
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
        event.entry.edge
          ? `…ぎりぎり踏ん張った！ ×${LIMIT_RULES.edgeMultiplier} +${event.entry.points}点。`
          : event.heldOn
            ? `…踏ん張った。+${event.entry.points}点。`
            : `${memberName(event.entry.id)}、持ちこたえた。+${event.entry.points}点。`,
      );
    } else if (event.type === 'recovered') {
      announce('…揺れが戻った。まだ、立っている。');
    } else if (event.type === 'finished') {
      if (coach?.name === 'guide') markTip('guide');
      locked = false;
      captions.cancel();
      audio.cancelProbe();
      selected = null;
      view.select(null);
      audio.success();
      closeDialogs();
      showResult();
    }
  }
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}
function restart(level = game.structure.id) {
  if (!ready) return;
  // 限界モードは常にその日の構造（日付が変わっていれば新しい構造）で始める
  if (mode === 'limit') level = dailyLevel(jstDay());
  generation++;
  captions.cancel();
  audio.cancelProbe();
  closeDialogs();
  collapsing = false;
  locked = false;
  countdown = mode === 'limit' ? 3 : 0;
  updateCountdown();
  selected = null;
  pulse = null;
  saveResult = null;
  submitted = false;
  board = null;
  audio.cancelCollapse();
  game.reset(level, roundOptions(level));
  view.load(game.structure, game.result);
  $('original-toggle').setAttribute('aria-pressed', 'false');
  $('audio-description').textContent = '';
  announce('');
  try {
    if (mode === 'classic') localStorage.setItem(ARCHITECTURE_KEY, game.structure.id);
  } catch {
    announce('このブラウザでは、選んだ構造を保存できませんでした。');
  }
  update();
  $('structure-viewport').focus({ preventScroll: true });
}
const SITE_URL = document.querySelector('link[rel="canonical"]').href;
// 抜いた順に一本ずつ印を並べる（ぎりぎり・荷重あり・軽い・崩れた一本）
const removalMark = (entry) => (!entry.stable ? '🟥' : entry.edge ? '🟧' : entry.meaningful ? '🟩' : '⬜');
function renderShare() {
  const s = game.stats,
    limit = game.mode === 'limit';
  const ending =
    game.status !== 'finished' ? '崩壊' : limit && game.endReason === 'timeout' ? '時間いっぱい' : '完成';
  const text = [
    limit ? `LESS, STILL. 今日の限界 ${roundDay}` : `LESS, STILL. ステージ${game.structure.number}`,
    `${game.structure.name} ${s.score.toLocaleString()}pt · ${s.count}本 · ${ending}`,
    game.history.map(removalMark).join(''),
  ]
    .filter(Boolean)
    .join('\n');
  $('share-text').value = `${text}\n${SITE_URL}`;
  $('share-x').href =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
  $('share-line').href = `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${SITE_URL}`)}`;
  $('share-copy-status').textContent = '';
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
    finished = game.status === 'finished',
    limit = game.mode === 'limit',
    timeout = game.endReason === 'timeout';
  $('result-eyebrow').textContent = limit
    ? `LIMIT MODE · ${roundDay}`
    : finished
      ? 'LESS, AND STILL STANDING.'
      : 'EVERY FALL TELLS A STORY.';
  $('result-title').textContent = finished
    ? limit
      ? timeout
        ? '時間いっぱい、立ち続けた。'
        : 'ここが、いまの限界。'
      : s.cleared
        ? 'この余白が、あなたの作品。'
        : '小さな余白も、ひとつの作品。'
    : 'その一本が、境目だった。';
  $('result-copy').textContent = finished
    ? `${game.structure.name}は、${s.count}本少なくなっても立っています。`
    : `${s.count}本まで、立っていました。崩れ方を眺めて、次の一本へ。`;
  $('result-score').textContent = s.score.toLocaleString();
  $('result-count').textContent = `${s.count}本`;
  $('result-reduction').textContent = `${Math.round(s.reduction * 100)}%`;
  const lost = Math.round((1 - LIMIT_RULES.collapseKeep) * 100);
  $('result-detail').textContent = limit
    ? `荷重ボーナス ${s.useful}本 · ぎりぎり ${s.edge}本 / ${
        !finished
          ? `崩壊で合計の${lost}%を失いました`
          : timeout
            ? '時間切れ'
            : `完成ボーナス +${s.finishBonus}（残り ${game.finishRemaining.toFixed(1)} 秒）`
      }`
    : `${s.count} / ${game.structure.target}本 · 荷重ボーナス ${s.useful}本${finished ? ` / 完成ボーナス +${s.finishBonus}` : ' / 崩壊した一本は加点されません'}`;
  $('save-status').textContent = !saveResult.saved
    ? '記録を保存できませんでした。この画面で結果を確認できます。'
    : saveResult.best
      ? 'NEW BEST · このブラウザに記録しました。'
      : 'このブラウザに自己ベストを保存しています。';
  $('result-view').textContent = finished ? '作品を見る' : '崩れたかたちを見る';
  $('result-replay').hidden = finished;
  renderShare();
  showRanking();
  update();
  $('result-dialog').showModal();
}

// ランキング（限界モードの結果画面）
const canSubmit = () =>
  game.mode === 'limit' &&
  game.status !== 'playing' &&
  game.actions.length > 0 &&
  game.seed === dailySeed(roundDay, game.structure.id);
function showRanking() {
  const visible = rankingEnabled && game.mode === 'limit';
  $('ranking').hidden = !visible;
  if (!visible) return;
  $('ranking-day').textContent = roundDay;
  try {
    $('ranking-name').value ||= localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    // 保存できない環境でも入力はできる
  }
  $('ranking-form').hidden = !canSubmit() || submitted;
  if (!submitted)
    $('ranking-status').textContent = canSubmit()
      ? 'ニックネームを付けて送ると、検証のあと順位に載ります。'
      : game.actions.length
        ? '練習用のシードなので、送信できません。'
        : '一本も抜いていないので、送信できません。';
  if (!board) void loadBoard();
  else renderBoard();
}
async function loadBoard() {
  const token = generation;
  $('ranking-list').replaceChildren();
  $('ranking-mine').textContent = '読み込み中…';
  try {
    const result = await fetchBoard(game.structure.id, roundDay);
    if (token !== generation) return;
    board = result;
  } catch (error) {
    if (token !== generation) return;
    $('ranking-mine').textContent = `ランキングを読み込めませんでした（${error.message}）。`;
    return;
  }
  renderBoard();
}
const STATUS_LABEL = { pending: '検証待ち', verified: '掲載済み', rejected: '不採用' };
function renderBoard() {
  document
    .querySelectorAll('[data-board]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.board === boardTab)));
  $('ranking-list').replaceChildren(
    ...boardItems(
      board?.[boardTab] ?? [],
      (row) => (boardTab === 'allTime' ? `${row.name} · ${row.day}` : row.name),
      'まだ掲載された記録はありません。',
    ),
  );
  $('ranking-mine').textContent = board?.mine?.length
    ? `自分の送信：${board.mine.map((row) => `${(row.score ?? row.claimed).toLocaleString()}pt ${STATUS_LABEL[row.status] ?? row.status}`).join(' / ')}`
    : '';
}
async function sendScore(event) {
  event.preventDefault();
  if (submitted || !canSubmit()) return;
  const name = $('ranking-name').value.trim();
  if (!name) return;
  const token = generation;
  submitted = true;
  $('ranking-submit').disabled = true;
  $('ranking-status').textContent = '送信中…';
  savePreference(NICKNAME_KEY, name);
  try {
    await submitScore({
      level: game.structure.id,
      day: roundDay,
      seed: game.seed,
      actions: game.actions,
      score: game.stats.score,
      name,
    });
    if (token !== generation) return;
    $('ranking-form').hidden = true;
    $('ranking-status').textContent = '送りました。リプレイ検証（10分ごと）が済むと順位に載ります。';
    board = dailyBoardKey = null;
    await loadBoard();
  } catch (error) {
    if (token !== generation) return;
    submitted = false;
    $('ranking-status').textContent = `送信できませんでした（${error.message}）。`;
  } finally {
    $('ranking-submit').disabled = false;
  }
}
$('ranking-form').addEventListener('submit', sendScore);
document.querySelectorAll('[data-board]').forEach((button) =>
  button.addEventListener('click', () => {
    boardTab = button.dataset.board;
    renderBoard();
  }),
);
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
$('settings-open').addEventListener('click', () => openSettings());
$('structure-open').addEventListener('click', () => openSettings());
$('daily-open').addEventListener('click', () => openSettings('daily'));
$('tab-stages').addEventListener('click', () => showTab('stages'));
$('tab-daily').addEventListener('click', () => showTab('daily'));
$('settings-dialog')
  .querySelector('[role="tablist"]')
  .addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    showTab(settingsTab === 'stages' ? 'daily' : 'stages');
    $(`tab-${settingsTab}`).focus();
  });
$('continue-stage').addEventListener('click', () => startRound($('continue-stage').dataset.level, 'classic'));
// 構造は restart がその日の構造に決める
$('daily-start').addEventListener('click', () => startRound(null, 'limit'));
$('coach-close').addEventListener('click', () => {
  markTip(coach.name);
  update();
});
$('guide-replay').addEventListener('click', () => {
  tips.delete('guide');
  saveTips();
  $('help-dialog').close();
  if (game.mode === 'classic' && game.structure.id === CATALOG[0].id && !game.history.length) update();
  else startRound(CATALOG[0].id, 'classic');
});
$('sound-open').addEventListener('click', () => $('sound-dialog').showModal());
$('records-open').addEventListener('click', () => $('records-dialog').showModal());
$('result-open').addEventListener('click', showResult);
$('share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('share-text').value);
    $('share-copy-status').textContent = 'コピーしました。';
  } catch {
    $('share-text').select();
    $('share-copy-status').textContent = '選択した文をコピーしてください。';
  }
});
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
  if (locked || countdown || !game.finish()) return;
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
  // 崩壊の物理は、手が空いたときに先読みしておく
  const idle = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 500));
  idle(() => view.loadPhysics().catch((error) => console.error(error)), { timeout: 3000 });
  view.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    $('loading').textContent = '3D描画が中断されました。ページを再読み込みしてください。';
    $('loading').hidden = false;
    update();
    window.dispatchEvent(new Event('structure-render-error'));
  });
  view.renderer.domElement.addEventListener('webglcontextrestored', () => {
    view.landscape.restore();
    ready = true;
    $('loading').hidden = true;
    update();
    window.dispatchEvent(new Event('structure-render-restored'));
  });
  let previousFrame = performance.now();
  let lastRender = 0;
  function frame(now) {
    const limit = game.mode === 'limit';
    // 限界モードは遅い端末でも持ち時間が実時間どおり減るよう、1フレームの上限を広げる。
    // 判定は固定 STEP で刻むので、1フレームで何 STEP 進んでも結果は同じ
    const dt = Math.min(limit ? 0.5 : 0.05, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    requestAnimationFrame(frame);
    if (!ready || document.hidden) return;
    try {
      // 限界モードはメニューを開いても止めない（考える時間も持ち時間のうち）
      const dialog = Boolean(document.querySelector('dialog[open]'));
      const paused = !limit && dialog;
      if (countdown) {
        countdown = Math.max(0, countdown - dt);
        updateCountdown();
      } else if (!paused && game.status === 'playing') {
        handleMotion(game.advance(dt));
        if (game.status === 'playing') view.followAnalysis(game.result, game.sway);
        if (limit) updateTimer();
      }
      // ダイアログの裏は 20fps に落とす（描画の上限 0.05 秒に合わせ、崩壊の物理は遅れない）
      if (dialog && now - lastRender < 50) return;
      lastRender = now;
      view.frame(now / 1000, !dialog);
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
    mode: game.mode,
    day: roundDay,
    timeLeft: Number.isFinite(game.timeLeft) ? game.timeLeft : null,
    elapsed: game.time,
    endReason: game.endReason,
    actions: game.actions.map((action) => ({ ...action })),
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
    coach: coach && { name: coach.name, step: coach.step ?? null },
    selectionCandidates: [...(view?.candidates ?? [])],
    locked,
    countdown,
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
