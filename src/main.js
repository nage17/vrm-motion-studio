import './style.css';
import { Viewport, loadModel } from './viewport.js';
import { exportVrma } from './vrma.js';
import { exportFighters, fighterCount } from './fighter-export.js';
import { applyHandShape, expressions, handShapes, isPairedJoint, isPairedShape } from './gestures.js';
import { inmuChorus } from './inmu-chorus.js';
import { parts, partNames, preset, readProject, surroundingFrames, projectType, maxFrames, maxTime, step, roundTime } from './project.js';

const $ = id => document.getElementById(id);
let frames = [preset('stand')];
let current = 0, position = 0, selected = 'rightLowerArm', playing = false;
let modelBusy = false, exportBusy = false, wasPreview = false, viewport;
let activeModel = '';
const axes = [...document.querySelectorAll('[data-axis]')].map(row => ({
  range: row.querySelector('input[type="range"]'),
  number: row.querySelector('input[type="number"]'),
}));

function announce(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

try {
  viewport = new Viewport($('viewport'), $('markers'), selectBone, editRotation);
} catch (error) {
  $('preview-fallback').hidden = false;
  announce('WebGLを有効にすると、VRMと3Dプレビューを使えます。', true);
}

const end = () => frames.at(-1).time;
const selectedFrame = () => frames[current];

function fitPairedHands() {
  if (!viewport) return;
  for (const frame of frames) {
    if (frame.pairedHands) applyHandShape(frame.angles, 'both', frame.pairedHands, viewport.rig);
  }
}

function renderParts() {
  const support = viewport ? viewport.rig.bones : partNames;
  const sections = parts.map((group, index) => {
    const fingers = index >= 3;
    const section = document.createElement(fingers ? 'details' : 'section');
    section.className = 'part-group';
    if (fingers) section.classList.add('finger-group');
    const heading = document.createElement(fingers ? 'summary' : 'h3');
    heading.textContent = group.label;
    const buttons = document.createElement('div');
    buttons.className = 'part-buttons';
    for (const [name, label] of group.bones) {
      if (!support[name]) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.bone = name;
      button.addEventListener('click', () => selectBone(name));
      buttons.append(button);
    }
    section.append(heading, buttons);
    return buttons.childElementCount ? section : null;
  }).filter(Boolean);
  $('part-list').replaceChildren(...sections);
}

function renderInspector() {
  $('joint-name').textContent = partNames[selected];
  const angles = selectedFrame().angles[selected] ?? [0, 0, 0];
  axes.forEach(({ range, number }, i) => {
    range.value = number.value = angles[i];
  });
  const expression = selectedFrame().expression ?? { name: 'neutral', weight: 1 };
  $('expression').value = expression.name;
  $('expression-weight').value = Math.round(expression.weight * 100);
  $('expression-weight').disabled = expression.name === 'neutral';
  $('expression-value').textContent = $('expression-weight').value + '%';
  const unsupported = expression.name !== 'neutral' && viewport && !viewport.rig.expressions?.includes(expression.name);
  $('expression-hint').hidden = !unsupported;
  $('expression-hint').textContent = unsupported ? 'このモデルに「' + expressions[expression.name] + '」の表情がありません。設定は保存されます。' : '';
  $('hip').value = Math.round(selectedFrame().hip * 100);
  $('hip-value').textContent = $('hip').value + '%';
  $('pose-controls').disabled = playing || wasPreview;
  for (const button of $('part-list').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.bone === selected));
  }
}

function redrawTime() {
  $('scrub').value = position;
  $('play-time').textContent = position.toFixed(2) + ' 秒';
}

function renderTimeline() {
  const duration = Math.max(1, end());
  $('scrub').max = duration;
  const ticks = [];
  for (let i = 0; i <= 4; i++) {
    const tick = document.createElement('span');
    tick.textContent = roundTime(i * duration / 4) + 's';
    ticks.push(tick);
  }
  $('ticks').replaceChildren(...ticks);
  $('frames').replaceChildren(...frames.map((frame, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame';
    button.setAttribute('aria-pressed', String(!wasPreview && index === current));
    button.setAttribute('aria-label', 'コマ ' + (index + 1) + '、' + frame.time + ' 秒');
    button.textContent = 'コマ ' + (index + 1);
    const sub = document.createElement('small');
    sub.textContent = frame.time.toFixed(2) + ' s';
    button.append(sub);
    button.addEventListener('click', () => chooseFrame(index));
    return button;
  }));
  $('frame-time').disabled = current === 0 || playing || wasPreview;
  $('frame-time').min = current > 0 ? roundTime(frames[current - 1].time + step) : 0;
  $('frame-time').max = current + 1 < frames.length ? roundTime(frames[current + 1].time - step) : maxTime;
  $('frame-time').value = selectedFrame().time.toFixed(2);
  $('frame-count').textContent = frames.length + ' コマ';
  $('remove-frame').disabled = frames.length < 2 || wasPreview || playing;
  $('add-frame').disabled = frames.length >= maxFrames || playing;
  $('play').disabled = frames.length < 2;
  $('play').innerHTML = playing ? '<span aria-hidden="true">Ⅱ</span> 停止' : '<span aria-hidden="true">▶</span> 再生';
  $('timeline-hint').textContent = wasPreview ? 'コマを選ぶとポーズを編集できます。' : '今のポーズをコピーして次のコマを作れます。';
  redrawTime();
}

function applyPose() {
  const [a, b, t] = surroundingFrames(frames, position);
  viewport?.apply(a, b, t);
}

function chooseFrame(index) {
  viewport?.cancelRotation();
  current = index;
  position = selectedFrame().time;
  playing = wasPreview = false;
  renderTimeline();
  renderInspector();
  applyPose();
}

function selectBone(name) {
  viewport?.cancelRotation();
  selected = name;
  if (playing || wasPreview) chooseFrame(current);
  else renderInspector();
}

function editRotation(bone, angles) {
  if (selected !== bone || playing || wasPreview) return;
  if (isPairedJoint(bone)) delete selectedFrame().pairedHands;
  selectedFrame().angles[bone] = angles;
  renderInspector();
  applyPose();
}

const axisButtons = [...document.querySelectorAll('[data-rotation-axis]')];
for (const button of axisButtons) {
  button.onclick = () => {
    viewport?.setAxis(button.dataset.rotationAxis);
    for (const axis of axisButtons) axis.setAttribute('aria-pressed', String(axis === button));
  };
}

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && viewport?.cancelRotation()) event.preventDefault();
});

function refreshFileButtons() {
  $('open-model').disabled = !viewport || modelBusy;
  $('export').disabled = !viewport || exportBusy || modelBusy;
  $('export-fighters').disabled = exportBusy;
}

async function useModel(file) {
  if (!file || !viewport || modelBusy) return;
  modelBusy = true;
  refreshFileButtons();
  $('viewport').setAttribute('aria-busy', 'true');
  announce('VRMの骨格と画像を読み込み中…');
  try {
    const model = await loadModel(file);
    viewport.setRig(model);
    fitPairedHands();
    if (!model.bones[selected]) selected = 'hips';
    activeModel = model.metaName;
    $('model-name').textContent = model.metaName;
    $('model-kind').textContent = model.flip ? 'VRM 0.x' : 'VRM 1.0';
    setView('angle');
    renderParts();
    chooseFrame(current);
    announce(model.metaName + ' を読み込みました。');
  } catch (error) {
    console.warn(error);
    announce(error instanceof Error && /[ぁ-んァ-ン]/.test(error.message) ? error.message : 'VRMを読み込めませんでした。ファイルを確認してください。', true);
  } finally {
    modelBusy = false;
    $('viewport').removeAttribute('aria-busy');
    refreshFileButtons();
  }
}

function setView(view) {
  viewport?.setView(view);
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}

function download(data, type, extension, base = activeModel) {
  const name = (base || 'motion').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 90) || 'motion';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name + extension;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('open-model').onclick = () => $('model-file').click();
$('model-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  void useModel(file);
};
for (const element of [$('viewport'), document.querySelector('.assets')]) {
  element.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  element.addEventListener('drop', e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void useModel(e.dataTransfer.files[0]);
  });
}

$('open-project').onclick = () => $('project-file').click();
$('project-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('編集用JSONは2 MB以下です。');
    const project = readProject(await file.text());
    viewport?.cancelRotation();
    frames = project.frames;
    fitPairedHands();
    chooseFrame(0);
    announce(project.model && project.model !== activeModel
      ? '編集ファイルを開きました。元の見た目で確認するには「' + project.model + '」のVRMを読み込んでください。'
      : '編集ファイルを開きました。');
  } catch (error) {
    announce(error instanceof SyntaxError ? '編集用JSONを読み込めませんでした。' : error.message, true);
  }
};

$('save-project').onclick = () => {
  download(JSON.stringify({ format: projectType, version: 1, model: activeModel, frames }, null, 2), 'application/json', '.motion.json');
  announce('編集用JSONを保存しました。このサイトで開き直せます。');
};

$('export').onclick = async () => {
  if (!viewport || exportBusy || modelBusy) return;
  exportBusy = true;
  refreshFileButtons();
  try {
    const data = await exportVrma(viewport.rig, structuredClone(frames));
    download(data, 'model/gltf-binary', '.vrma');
    announce('VRMAを書き出しました。VRM Animation対応ソフトで使えます。');
  } catch (error) {
    console.warn(error);
    announce('VRMAを書き出せませんでした。', true);
  } finally {
    exportBusy = false;
    refreshFileButtons();
  }
};

$('export-fighters').onclick = async () => {
  if (exportBusy) return;
  exportBusy = true;
  refreshFileButtons();
  announce('全' + fighterCount + 'ファイターのVRMAを作成中…');
  try {
    const archive = await exportFighters(structuredClone(frames), activeModel);
    download(archive, 'application/zip', '.zip', 'VRM-BRAWL-poses');
    announce('全' + fighterCount + 'ファイター分のVRMAと編集用JSONをZIPに保存しました。');
  } catch (error) {
    console.warn(error);
    announce('全ファイター分のZIPを書き出せませんでした。', true);
  } finally {
    exportBusy = false;
    refreshFileButtons();
  }
};

for (const button of document.querySelectorAll('[data-view]')) {
  button.onclick = () => setView(button.dataset.view);
}
for (const [i, { range, number }] of axes.entries()) {
  function setAngle(value) {
    if (isPairedJoint(selected)) delete selectedFrame().pairedHands;
    const angles = selectedFrame().angles[selected] ?? [0, 0, 0];
    angles[i] = value;
    selectedFrame().angles[selected] = angles;
    applyPose();
  }
  range.oninput = () => {
    number.value = range.value;
    setAngle(range.valueAsNumber);
  };
  number.oninput = () => {
    const value = number.valueAsNumber;
    if (!Number.isFinite(value) || Math.abs(value) > 180) return;
    range.value = value;
    setAngle(value);
  };
  number.onchange = () => {
    const value = number.valueAsNumber;
    if (Number.isFinite(value)) setAngle(Math.max(-180, Math.min(180, value)));
    number.value = range.value = selectedFrame().angles[selected]?.[i] ?? 0;
  };
}

const handOptions = Object.entries(handShapes).map(([id, [label]]) => [id, label]);
for (const [id, side] of [['right-hand', 'right'], ['left-hand', 'left'], ['both-hands', 'both']]) {
  const select = $(id);
  select.add(new Option('手の形を選ぶ', ''));
  for (const [shape, label] of handOptions) {
    if ((side === 'both') === (shape === 'circle' || shape === 'heart')) select.add(new Option(label, shape));
  }
  select.onchange = () => {
    if (!select.value) return;
    const frame = selectedFrame();
    applyHandShape(frame.angles, side, select.value, viewport?.rig);
    if (isPairedShape(select.value)) frame.pairedHands = select.value;
    else delete frame.pairedHands;
    announce((side === 'both' ? '両手' : side === 'right' ? '右手' : '左手') + 'に「' + handShapes[select.value][0] + '」を適用しました。');
    select.value = '';
    renderInspector();
    applyPose();
  };
}
for (const [name, label] of Object.entries(expressions)) $('expression').add(new Option(label, name));
$('expression').onchange = () => {
  const name = $('expression').value;
  if (name === 'neutral') delete selectedFrame().expression;
  else selectedFrame().expression = { name, weight: selectedFrame().expression?.weight ?? 1 };
  renderInspector();
  applyPose();
};
$('expression-weight').oninput = () => {
  if (!selectedFrame().expression) return;
  selectedFrame().expression.weight = Number($('expression-weight').value) / 100;
  $('expression-value').textContent = $('expression-weight').value + '%';
  applyPose();
};
$('hip').oninput = event => {
  selectedFrame().hip = Number(event.target.value) / 100;
  $('hip-value').textContent = event.target.value + '%';
  applyPose();
};
$('reset-joint').onclick = () => {
  if (isPairedJoint(selected)) delete selectedFrame().pairedHands;
  delete selectedFrame().angles[selected];
  renderInspector();
  applyPose();
};
for (const button of document.querySelectorAll('[data-preset]')) {
  button.onclick = () => {
    frames[current] = preset(button.dataset.preset, selectedFrame().time);
    renderInspector();
    applyPose();
  };
}

$('add-frame').onclick = () => {
  if (frames.length >= maxFrames) return;
  const next = frames[current + 1];
  const here = selectedFrame().time;
  let index = current + 1;
  let time = roundTime(here + .5);
  if (next && next.time - here >= .10 - 1e-8) time = roundTime(Math.min(time, (here + next.time) / 2));
  else if (next) {
    index = frames.length;
    time = roundTime(end() + .5);
  }
  if (time > maxTime) {
    announce('タイムラインは120秒までです。', true);
    return;
  }
  frames.splice(index, 0, { ...structuredClone(selectedFrame()), time });
  chooseFrame(index);
  $('frames').children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  announce('コマ ' + (index + 1) + ' を追加しました。');
};

$('remove-frame').onclick = () => {
  if (frames.length < 2) return;
  frames.splice(current, 1);
  const start = frames[0].time;
  if (start) for (const frame of frames) frame.time = roundTime(frame.time - start);
  chooseFrame(Math.max(0, current - 1));
  announce('コマを削除しました。');
};

$('frame-time').onchange = event => {
  if (!current) return;
  const input = event.target;
  if (Number.isFinite(input.valueAsNumber)) {
    selectedFrame().time = roundTime(Math.max(Number(input.min), Math.min(Number(input.max), input.valueAsNumber)));
  }
  chooseFrame(current);
};

$('scrub').oninput = event => {
  viewport?.cancelRotation();
  const previous = wasPreview;
  wasPreview = true;
  playing = false;
  position = Math.min(Number(event.target.value), end());
  if (!previous || $('play').textContent.includes('停止')) {
    renderTimeline();
    renderInspector();
  } else redrawTime();
  applyPose();
};

function startPlayback() {
  if (end() <= 0) return;
  viewport?.cancelRotation();
  playing = wasPreview = true;
  if (position >= end()) position = 0;
  renderTimeline();
  renderInspector();
}
$('play').onclick = () => {
  if (playing) chooseFrame(current);
  else startPlayback();
};

const danceDialog = $('dance-dialog');
function loadChorus(clip, append) {
  const index = append ? frames.length : 0;
  const offset = append ? roundTime(end() + .25) : 0;
  if (!append) frames = [];
  frames.push(...clip.map(frame => ({ ...frame, time: roundTime(frame.time + offset) })));
  chooseFrame(index);
  $('frames').children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  startPlayback();
  announce('INMU KINGのサビを再生中。停止してコマを選ぶと編集できます。');
}
$('inmu-chorus').onclick = () => {
  const clip = inmuChorus();
  if (frames.length === 1 && JSON.stringify(frames[0]) === JSON.stringify(preset('stand'))) {
    loadChorus(clip, false);
    return;
  }
  const canAppend = frames.length + clip.length <= maxFrames && end() + .25 + clip.at(-1).time <= maxTime;
  $('dance-append').disabled = !canAppend;
  $('dance-insert-hint').textContent = canAppend
    ? '末尾に追加すると、今のコマを残せます。新しく開くと、タイムラインがサビのモーションに切り替わります。'
    : 'タイムラインの上限を超えるため、末尾に追加できません。新しく開くと今のコマを置き換えます。';
  danceDialog.returnValue = '';
  danceDialog.showModal();
};
danceDialog.onclose = () => {
  if (danceDialog.returnValue === 'append' || danceDialog.returnValue === 'replace') {
    loadChorus(inmuChorus(), danceDialog.returnValue === 'append');
  }
};

let lastFrame = 0;
function animate(time) {
  if (playing) {
    position += Math.min(.08, (time - lastFrame) / 1000);
    if (position >= end()) {
      if ($('loop').checked) position %= end();
      else chooseFrame(frames.length - 1);
    }
    redrawTime();
    applyPose();
  }
  lastFrame = time;
  viewport?.render(selected, !playing && !wasPreview);
  requestAnimationFrame(animate);
}
renderParts();
chooseFrame(0);
refreshFileButtons();
requestAnimationFrame(animate);
