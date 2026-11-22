import './style.css';
import { Viewport, loadModel } from './viewport.js';
import { exportVrma } from './vrma.js';
import { parts, partNames, preset, readProject, surroundingFrames, projectType, maxFrames, maxTime, step, roundTime } from './project.js';

const $ = id => document.getElementById(id);
let frames = [preset('stand')];
let current = 0, position = 0, selected = 'rightLowerArm', playing = false;
let modelBusy = false, exportBusy = false, wasPreview = false, viewport;
let activeModel = '';
const axes = [...document.querySelectorAll('[data-axis]')];

function announce(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

try {
  viewport = new Viewport($('viewport'), $('markers'), selectBone, beginDrag);
} catch (error) {
  $('preview-fallback').hidden = false;
  announce('WebGLを有効にすると、VRMと3Dプレビューを使えます。', true);
}

const clamp = value => Math.max(-180, Math.min(180, Math.round(value)));
const end = () => frames.at(-1).time;
const selectedFrame = () => frames[current];

function renderParts() {
  const support = viewport ? viewport.rig.bones : partNames;
  const sections = parts.map(group => {
    const section = document.createElement('section');
    section.className = 'part-group';
    const heading = document.createElement('h3');
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
    return section;
  });
  $('part-list').replaceChildren(...sections);
}

function renderInspector() {
  $('joint-name').textContent = partNames[selected];
  const angles = selectedFrame().angles[selected] ?? [0, 0, 0];
  axes.forEach((row, i) => {
    row.querySelector('input').value = angles[i];
    row.querySelector('output').textContent = angles[i] + '°';
  });
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
  current = index;
  position = selectedFrame().time;
  playing = wasPreview = false;
  renderTimeline();
  renderInspector();
  applyPose();
}

function selectBone(name) {
  selected = name;
  if (playing || wasPreview) chooseFrame(current);
  else renderInspector();
}

function beginDrag() {
  const [x, y, z] = selectedFrame().angles[selected] ?? [0, 0, 0];
  const bone = selected;
  return (dx, dy) => {
    if (selected !== bone || playing || wasPreview) return;
    selectedFrame().angles[bone] = [clamp(x + dy * .75), y, clamp(z + dx * .75)];
    renderInspector();
    applyPose();
  };
}

function refreshFileButtons() {
  $('open-model').disabled = !viewport || modelBusy;
  $('export').disabled = !viewport || exportBusy || modelBusy;
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

function download(data, type, extension) {
  const name = (activeModel || 'motion').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 90) || 'motion';
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
    frames = project.frames;
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

for (const button of document.querySelectorAll('[data-view]')) {
  button.onclick = () => setView(button.dataset.view);
}
for (const [i, row] of axes.entries()) {
  row.querySelector('input').oninput = event => {
    const angles = selectedFrame().angles[selected] ?? [0, 0, 0];
    angles[i] = Number(event.target.value);
    selectedFrame().angles[selected] = angles;
    row.querySelector('output').textContent = angles[i] + '°';
    applyPose();
  };
}
$('hip').oninput = event => {
  selectedFrame().hip = Number(event.target.value) / 100;
  $('hip-value').textContent = event.target.value + '%';
  applyPose();
};
$('reset-joint').onclick = () => {
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

$('play').onclick = () => {
  if (playing) {
    chooseFrame(current);
    return;
  }
  if (end() <= 0) return;
  playing = wasPreview = true;
  if (position >= end()) position = 0;
  renderTimeline();
  renderInspector();
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
