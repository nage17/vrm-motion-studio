import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createDemo } from './demo.js';
import { partNames } from './project.js';
import { rotation } from './vrma.js';
import { expressionWeight } from './gestures.js';

export async function loadModel(file) {
  if (!/\.vrm$/i.test(file.name)) throw new Error('拡張子が .vrm のファイルを選んでください。');
  if (file.size > 128 * 1024 * 1024) throw new Error('128 MB以下のVRMを選んでください。');
  const data = await file.arrayBuffer();
  const view = new DataView(data);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('VRMファイルを読み込めませんでした。');

  const manager = new T.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw new Error('画像を内蔵したVRMファイルを選んでください。');
  });
  const loader = new GLTFLoader(manager).register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(data, '');
  try {
    const vrm = gltf.userData.vrm;
    if (!vrm?.humanoid) throw new Error('身体の骨格があるVRMモデルを選んでください。');
    const flip = vrm.meta.metaVersion === '0';
    if (flip) VRMUtils.rotateVRM0(vrm);
    vrm.humanoid.resetNormalizedPose();
    vrm.update(0);
    gltf.scene.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(gltf.scene);
    const dimensions = box.getSize(new T.Vector3());
    if (!(dimensions.y > .001 && Number.isFinite(dimensions.y))) throw new Error('モデルの身長を取得できませんでした。');
    const bones = Object.fromEntries(Object.entries(vrm.humanoid.normalizedHumanBones).map(([name, bone]) => [name, bone.node]));
    const expressions = vrm.expressionManager;
    return {
      model: gltf.scene, bones, flip, ground: box.min.y, height: dimensions.y,
      center: box.getCenter(new T.Vector3()), metaName: vrm.meta.name || vrm.meta.title || file.name,
      expressions: Object.keys(expressions?.presetExpressionMap ?? {}),
      setExpression: (name, weight) => expressions?.setValue(name, weight),
      update: () => {
        vrm.humanoid.update();
        expressions?.update();
      },
    };
  } catch (error) {
    VRMUtils.deepDispose(gltf.scene);
    throw error;
  }
}

const markerNames = [
  'head', 'neck', 'chest', 'hips', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
];

class JointRotationControls extends TransformControls {
  pointerDown(pointer) {
    this.fineStart = this.fine && pointer ? { x: pointer.x, y: pointer.y } : null;
    super.pointerDown(pointer);
  }

  pointerMove(pointer) {
    if (pointer && this.fineStart && this.dragging) {
      const { x, y } = this.fineStart;
      pointer = { ...pointer, x: x + (pointer.x - x) * .25, y: y + (pointer.y - y) * .25 };
    }
    super.pointerMove(pointer);
  }
}

export class Viewport {
  constructor(container, markerLayer, selectBone, editRotation) {
    this.container = container;
    this.layer = markerLayer;
    this.selectBone = selectBone;
    this.editRotation = editRotation;
    this.editEuler = new T.Euler();
    this.editQuaternion = new T.Quaternion();
    this.markers = new Map();
    this.position = new T.Vector3();
    this.qa = new T.Quaternion();
    this.qb = new T.Quaternion();
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(31, 1, .01, 60);
    this.group = new T.Group();
    this.scene.add(this.group);
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.21;
    this.renderer.domElement.setAttribute('aria-label', 'VRM モデル');
    container.prepend(this.renderer.domElement);

    // Register the rotation tool first so grabbing a ring claims the pointer before the camera does.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', event => { this.transform.fine = event.shiftKey; }, { capture: true });
    this.transform = new JointRotationControls(this.camera, canvas);
    this.transform.setMode('rotate');
    this.transform.setSpace('local');
    this.transform.setSize(.53);
    this.transform.setColors(0xff797d, 0x8ade9f, 0x83b7ff, 0xffdf96);
    this.scene.add(this.transform.getHelper());
    this.transform.enabled = false;
    this.transform.addEventListener('change', () => {
      this.dirty = true;
      canvas.classList.toggle('rotation-hover', !!this.transform.axis);
    });
    this.transform.addEventListener('dragging-changed', ({ value }) => {
      this.orbit.enabled = !value;
      this.container.classList.toggle('rotating', value);
    });
    this.transform.addEventListener('objectChange', () => {
      this.editQuaternion.copy(this.transform.object.quaternion);
      if (this.rig.flip) this.editQuaternion.set(-this.editQuaternion.x, this.editQuaternion.y, -this.editQuaternion.z, this.editQuaternion.w);
      this.editEuler.setFromQuaternion(this.editQuaternion);
      const angles = [this.editEuler.x, this.editEuler.y, this.editEuler.z].map(rad => Math.round(T.MathUtils.radToDeg(rad) * 10) / 10);
      this.editRotation(this.selected, angles);
    });
    this.renderer.domElement.addEventListener('lostpointercapture', () => {
      if (this.transform.dragging) this.transform.pointerUp(null);
    });
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 10;
    this.orbit.maxPolarAngle = Math.PI * .51;
    this.setView('angle');

    this.scene.add(new T.HemisphereLight(0xf3f7ff, 0x454b60, 2.25));
    const key = new T.DirectionalLight(0xffeed9, 3.25);
    key.position.set(3, 5, 4);
    const fill = new T.DirectionalLight(0xa8c9fd, 2.1);
    fill.position.set(-3, 3, -3);
    this.scene.add(key, fill);

    const grid = new T.GridHelper(22, 70, 0x586984, 0x2b3a51);
    grid.position.y = -.02;
    grid.material.transparent = true;
    grid.material.opacity = .50;
    this.scene.add(grid);
    for (const [radius, color] of [[.65, 0xffb172], [.94, 0x5f7394]]) {
      const base = new T.Mesh(
        new T.RingGeometry(radius, radius + .006, 96),
        new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity: .65 }),
      );
      base.rotation.x = -Math.PI / 2;
      base.position.y = -.013;
      this.scene.add(base);
    }

    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.layer.hidden = true;
      container.querySelector('#preview-fallback').hidden = false;
      container.querySelector('#preview-fallback').textContent = '3D表示が一時停止しました。';
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.dirty = true;
      this.layer.hidden = false;
      container.querySelector('#preview-fallback').hidden = true;
    });
    this.setRig(createDemo());
  }

  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }

  setView(view) {
    this.orbit.target.set(0, .87, 0);
    if (view === 'front') this.camera.position.set(0, 1.06, 3.74);
    else if (view === 'side') this.camera.position.set(3.74, 1.06, 0);
    else this.camera.position.set(1.53, 1.20, 3.67);
    this.orbit.update();
    this.dirty = true;
  }

  setAxis(axis) {
    this.cancelRotation();
    this.transform.showX = axis === 'all' || axis === 'X';
    this.transform.showY = axis === 'all' || axis === 'Y';
    this.transform.showZ = axis === 'all' || axis === 'Z';
    this.transform.axis = null;
  }

  cancelRotation() {
    if (!this.transform.dragging) return false;
    this.transform.reset();
    this.transform.pointerUp(null);
    return true;
  }

  setRig(rig) {
    this.cancelRotation();
    this.transform.detach();
    this.transform.enabled = false;
    if (this.rig) {
      this.group.remove(this.rig.model);
      VRMUtils.deepDispose(this.rig.model);
    }
    this.rig = rig;
    rig.rest = new Map(Object.entries(rig.bones).map(([name, bone]) => [name, bone.position.clone()]));
    rig.hipHeight = Math.max(.001, rig.rest.get('hips').y);
    const scale = 1.7 / rig.height;
    this.group.scale.setScalar(scale);
    this.group.position.set(-(rig.center?.x ?? 0) * scale, -rig.ground * scale, -(rig.center?.z ?? 0) * scale);
    this.group.add(rig.model);
    this.layer.replaceChildren();
    this.markers.clear();
    for (const name of markerNames) {
      if (!rig.bones[name]) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'joint-marker';
      button.tabIndex = -1;
      button.title = partNames[name];
      button.setAttribute('aria-label', partNames[name]);
      button.addEventListener('click', () => this.selectBone(name));
      this.layer.append(button);
      this.markers.set(name, button);
    }
    this.setView('angle');
  }

  apply(a, b, t) {
    for (const [name, bone] of Object.entries(this.rig.bones)) {
      rotation(a.angles[name], this.qa);
      if (a !== b) this.qa.slerp(rotation(b.angles[name], this.qb), t);
      if (this.rig.flip) this.qa.set(-this.qa.x, this.qa.y, -this.qa.z, this.qa.w);
      bone.quaternion.copy(this.qa);
    }
    const hips = this.rig.bones.hips;
    hips.position.copy(this.rig.rest.get('hips'));
    hips.position.y += T.MathUtils.lerp(a.hip, b.hip, t) * this.rig.hipHeight;
    for (const name of this.rig.expressions ?? []) {
      const weight = T.MathUtils.lerp(expressionWeight(a, name), expressionWeight(b, name), t);
      this.rig.setExpression(name, weight);
    }
    this.rig.update?.();
    this.dirty = true;
  }

  render(selected, showMarkers) {
    const bone = showMarkers ? this.rig.bones[selected] : null;
    if (bone !== (this.transform.object ?? null)) {
      this.cancelRotation();
      if (bone) this.transform.attach(bone);
      else this.transform.detach();
      this.transform.enabled = Boolean(bone);
    }
    const cameraMoved = this.transform.dragging ? false : this.orbit.update();
    if (!cameraMoved && !this.dirty && selected === this.selected && showMarkers === this.showMarkers) return;
    this.dirty = false;
    this.selected = selected;
    this.showMarkers = showMarkers;
    this.renderer.render(this.scene, this.camera);
    for (const [name, button] of this.markers) {
      this.rig.bones[name].getWorldPosition(this.position).project(this.camera);
      const { x, y, z } = this.position;
      button.hidden = !showMarkers || z > 1 || Math.abs(x) > 1 || Math.abs(y) > 1;
      if (button.hidden) continue;
      button.style.left = (x * .5 + .5) * 100 + '%';
      button.style.top = (.5 - y * .5) * 100 + '%';
      button.classList.toggle('selected', name === selected);
    }
  }
}
