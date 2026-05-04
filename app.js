import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IFCLoader } from 'web-ifc-three';

const CONFIG = {
    WALK_SPEED: 0.8,
    XRAY_OPACITY: 0.2,
    COLOR_HIGHLIGHT: 0x174ea6,
    COLOR_POINT_1: 0x1a73e8,
    COLOR_POINT_2: 0xd93025,
    COLOR_MEASURE_LINE: 0xfbbc04
};

const ifcTypesToRu = {
    'IFCPROJECT': 'Проект',
    'IFCSITE': 'Участок',
    'IFCBUILDING': 'Здание',
    'IFCBUILDINGSTOREY': 'Этаж',
    'IFCWALL': 'Стена',
    'IFCWALLSTANDARDCASE': 'Стена',
    'IFCWINDOW': 'Окно',
    'IFCDOOR': 'Дверь',
    'IFCSLAB': 'Перекрытие',
    'IFCCOLUMN': 'Колонна',
    'IFCBEAM': 'Балка',
    'IFCSTAIR': 'Лестница',
    'IFCFLOWSEGMENT': 'Труба/Воздуховод',
    'IFCFLOWFITTING': 'Фитинг',
    'IFCBUILDINGELEMENTPROXY': 'Оборудование'
};

async function getHumanName(manager, modelID, expressID, type) {
    try {
        const props = await manager.getItemProperties(modelID, expressID);
        let name = props?.Name?.value || props?.LongName?.value;
        if (name) return name;
        
        const cleanType = type.toUpperCase();
        return ifcTypesToRu[cleanType] || type;
    } catch (e) {
        return type;
    }
}

function getAllIds(node) {
    let ids = [node.expressID];
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            ids = ids.concat(getAllIds(child));
        }
    }
    return ids;
}

async function buildFastPropertyIndex(manager, modelID) {
    const indexMap = {};
    try {
        const rels = await manager.getAllItemsOfType(modelID, 41, false);
        
        for (const relID of rels) {
            const rel = await manager.getItemProperties(modelID, relID);
            if (!rel || !rel.RelatingPropertyDefinition || !rel.RelatingObjects) continue;
            
            const psetID = rel.RelatingPropertyDefinition.value;
            const pset = await manager.getItemProperties(modelID, psetID);
            
            if (!pset || !pset.HasProperties) continue;
            
            let sys = null;
            let fam = null;
            
            for (const propRef of pset.HasProperties) {
                const prop = await manager.getItemProperties(modelID, propRef.value);
                if (!prop || !prop.Name || !prop.NominalValue) continue;
                
                const pName = prop.Name.value.toLowerCase();
                const pVal = String(prop.NominalValue.value);
                
                if (pName.includes('имя системы') || pName.includes('system name')) sys = pVal.toLowerCase();
                if (pName.includes('семейство и типоразмер') || pName.includes('family and type')) fam = pVal.toLowerCase();
            }
            
            if (sys || fam) {
                for (const objRef of rel.RelatingObjects) {
                    const elemID = objRef.value;
                    if (!indexMap[elemID]) indexMap[elemID] = {};
                    if (sys) indexMap[elemID].s = sys;
                    if (fam) indexMap[elemID].f = fam;
                }
            }
        }
    } catch (e) {
        console.error("Ошибка быстрого индексирования", e);
    }
    return indexMap;
}

class BIMApp {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.loader = null;
        this.cubeScene = null;
        this.cubeCamera = null;
        this.cubeRenderer = null;
        this.loadedModels = new Map(); // Map<modelName, {mesh, modelID, visible}>
        this.currentSelected = { id: null, modelId: null };
        this.hiddenElements = new Map(); // Map<modelID, Set<expressID>>
        this.currentModelID = null;
        this.currentModelName = null;
        this.xrayMode = false;
        this.isOrthographic = false;
        this.allSpaces = [];
        this.spacesMode = false;
        this.sectionMode = false;
        this.planeY = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
        this.planeX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
        this.boxLimits = new THREE.Box3();
        this.measureMode = false;
        this.measurePoints = [];
        this.measureGroup = new THREE.Group();
        this.measureGroup.renderOrder = 999;
        this.pointerDownPos = new THREE.Vector2();
        this.minecraftMode = false;
        this.messageTimeout = null;
        this.needsUpdate = true;
        this.dirLight = null;
        this.ambientLight = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.highlightMaterial = new THREE.MeshBasicMaterial({
            color: CONFIG.COLOR_HIGHLIGHT,
            depthTest: false,
            transparent: true,
            opacity: 0.5
        });
        this.systemMaterial = null;
        this.propertyCache = new Map(); // Кэш свойств для оптимизации

        this.elements = {
            container: document.getElementById('container'),
            status: document.getElementById('status'),
            fileInput: document.getElementById('file-input'),
            btnAddFile: document.getElementById('btn-add-file'),
            btnResetScene: document.getElementById('btn-reset-scene'),
            btnHome: document.getElementById('home-btn'),
            btnModels: document.getElementById('btn-models'),
            panelModels: document.getElementById('nav-panel'),
            modelsList: document.getElementById('local-models-list'),
            propsPanel: document.getElementById('props-panel'),
            propsContent: document.getElementById('props-content'),
            btnCloseProps: document.getElementById('btn-close-props'),
            btnHideElement: document.getElementById('btn-hide-element'),
            btnResetVisibility: document.getElementById('btn-reset-visibility'),
            btnCam: document.getElementById('btn-cam'),
            btnXray: document.getElementById('btn-xray'),
            btnSpaces: document.getElementById('btn-spaces-toggle'),
            helpBtnFloat: document.getElementById('help-btn-float'),
            helpModal: document.getElementById('help-modal'),
            btnCloseHelp: document.getElementById('btn-close-help'),
            btnSection: document.getElementById('btn-section'),
            panelSection: document.getElementById('section-panel'),
            checkY: document.getElementById('check-sec-y'),
            rangeY: document.getElementById('range-sec-y'),
            checkX: document.getElementById('check-sec-x'),
            rangeX: document.getElementById('range-sec-x'),
            btnSettings: document.getElementById('btn-settings'),
            panelSettings: document.getElementById('settings-panel'),
            inputBgColor: document.getElementById('input-bg-color'),
            rangeSens: document.getElementById('range-sens'),
            checkGpu: document.getElementById('check-gpu'),
            btnModeSport: document.getElementById('btn-mode-sport'),
            btnModeBalance: document.getElementById('btn-mode-balance'),
            btnModeBeauty: document.getElementById('btn-mode-beauty'),
            btnMeasure: document.getElementById('btn-measure'),
            panelMeasure: document.getElementById('measure-panel'),
            measureResults: document.getElementById('measure-results'),
            btnClearMeasure: document.getElementById('btn-clear-measure'),
            btnSecret: document.getElementById('btn-secret-mode'),
            hardhatOverlay: document.getElementById('hardhat-overlay'),
            hardhatMessage: document.getElementById('hardhat-message')
        };
        this.init();
    }

    async init() {
        this.loader = new IFCLoader();
        await this.loader.ifcManager.setWasmPath('./node_modules/web-ifc/');
        this.log('WASM initialized');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.elements.inputBgColor.value);
        this.scene.add(this.measureGroup);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        this.dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
        this.dirLight.position.set(20, 50, 20);
        this.scene.add(this.ambientLight, this.dirLight);

        const width = this.elements.container.clientWidth || window.innerWidth;
        const height = this.elements.container.clientHeight || window.innerHeight;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
        
        const useHighPerf = localStorage.getItem('bim_gpu_perf') !== 'false';
        this.elements.checkGpu.checked = useHighPerf;
        
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: useHighPerf ? "high-performance" : "default"
        });
        this.renderer.setSize(width, height);
        this.renderer.localClippingEnabled = false;
        this.elements.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;

        this.controls.addEventListener('change', () => { this.needsUpdate = true; });

        this.pivotSphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0xff00ff,
                depthTest: false,
                transparent: true,
                opacity: 0.8
            })
        );
        this.pivotSphere.visible = false;
        this.scene.add(this.pivotSphere);

        this.controls.addEventListener('start', () => {
            this.pivotSphere.position.copy(this.controls.target);
            this.pivotSphere.visible = true;
            this.needsUpdate = true;
        });
        this.controls.addEventListener('end', () => {
            this.pivotSphere.visible = false;
            this.needsUpdate = true;
        });

        this.initViewCube();
        this.setQualityMode(0);
        this.bindEvents();
        await this.loadDefault();
        this.animate();
        window.app = this;
        this.log('App initialized and running v8.0.1');
        this.log('Рендер запущен');
    }

    log(message) {
        const debugLog = document.getElementById('debug-log');
        if (!debugLog) return;
        const time = new Date().toLocaleTimeString();
        const timestampedMsg = `[${time}] ${message}`;
        debugLog.innerHTML += `${timestampedMsg}\n`;
        debugLog.scrollTop = debugLog.scrollHeight;
        console.log(timestampedMsg);
    }

    /**
     * Безопасное получение свойств элемента с кэшированием и обработкой ошибок web-ifc
     */
    async getSafeProperties(modelID, expressID, useCache = true) {
        const cacheKey = `${modelID}_${expressID}`;
        
        if (useCache && this.propertyCache.has(cacheKey)) {
            return this.propertyCache.get(cacheKey);
        }

        try {
            const props = await this.loader.ifcManager.getItemProperties(modelID, expressID);
            this.propertyCache.set(cacheKey, props);
            return props;
        } catch (e) {
            this.log(`⚠️ Ошибка получения свойств для ID ${expressID} в модели ${modelID}: ${e.message}`);
            return null;
        }
    }

    /**
     * Безопасное получение PSet с обработкой ошибок ядра
     */
    async getSafePropertySets(modelID, expressID) {
        try {
            const psets = await this.loader.ifcManager.getPropertySets(modelID, expressID, true);
            return psets || [];
        } catch (e) {
            this.log(`⚠️ Ошибка получения PSet для ID ${expressID}: ${e.message}`);
            return [];
        }
    }

    bindEvents() {
        window.addEventListener('resize', () => this.onResize());
        
        // Обработчик dblclick на канвасе для выделения элементов
        this.renderer.domElement.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this.pointerDownPos.set(e.clientX, e.clientY);
        });

        this.renderer.domElement.addEventListener('pointerup', (e) => {
            if (e.button !== 0 || !this.measureMode) return;
            
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
            if (dist > 5) return;
            
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            // Извлекаем сами mesh-объекты из loadedModels для корректного raycasting
            const visibleMeshes = Array.from(this.loadedModels.values())
                .filter(m => m.visible)
                .map(m => m.mesh);
            const hits = this.raycaster.intersectObjects(visibleMeshes);
            
            if (hits.length > 0) {
                this.addMeasurePoint(hits[0].point);
            }
        });

        this.elements.btnAddFile.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => this.handleUpload(e));
        this.elements.btnCam.addEventListener('click', () => this.toggleCamera());
        this.elements.btnXray.addEventListener('click', () => this.toggleXRay());
        this.elements.btnSpaces.addEventListener('click', () => this.toggleSpacesMode());
        this.elements.btnResetScene.addEventListener('click', () => location.reload());
        this.elements.btnHome.addEventListener('click', () => this.fitCamera());
        this.elements.btnCloseProps.addEventListener('click', () => this.hideProps());
        this.elements.btnHideElement.addEventListener('click', () => this.hideSelectedElement());
        this.elements.btnResetVisibility.addEventListener('click', () => this.resetVisibility());
        
        if (this.elements.helpBtnFloat) {
            this.elements.helpBtnFloat.addEventListener('click', () => this.elements.helpModal.classList.remove('hidden'));
            this.elements.btnCloseHelp.addEventListener('click', () => this.elements.helpModal.classList.add('hidden'));
        }
        if (this.elements.btnModels) {
            this.elements.btnModels.addEventListener('click', () => {
                this.elements.panelModels.classList.toggle('hidden');
                this.elements.btnModels.classList.toggle('btn-active');
            });
        }
        
        if (this.elements.btnSection) {
            this.elements.btnSection.addEventListener('click', () => this.toggleSectionPanel());
            this.elements.checkY.addEventListener('change', () => this.applyClipping());
            this.elements.checkX.addEventListener('change', () => this.applyClipping());
            this.elements.rangeY.addEventListener('input', (e) => {
                this.planeY.constant = parseFloat(e.target.value);
                this.needsUpdate = true;
            });
            this.elements.rangeX.addEventListener('input', (e) => {
                this.planeX.constant = parseFloat(e.target.value);
                this.needsUpdate = true;
            });
        }
        
        this.elements.btnSettings.addEventListener('click', () => {
            this.elements.panelSettings.classList.toggle('hidden');
            this.elements.btnSettings.classList.toggle('btn-active');
        });
        this.elements.inputBgColor.addEventListener('input', (e) => {
            this.scene.background = new THREE.Color(e.target.value);
            this.needsUpdate = true;
        });
        this.elements.rangeSens.addEventListener('input', (e) => {
            this.controls.rotateSpeed = parseFloat(e.target.value);
        });
        
        this.elements.checkGpu.addEventListener('change', (e) => {
            localStorage.setItem('bim_gpu_perf', e.target.checked);
            this.setStatus("Настройка GPU сохранена. Применится после F5.");
        });
        this.elements.btnModeSport.addEventListener('click', () => this.setQualityMode(0));
        this.elements.btnModeBalance.addEventListener('click', () => this.setQualityMode(1));
        this.elements.btnModeBeauty.addEventListener('click', () => this.setQualityMode(2));

        this.elements.btnMeasure.addEventListener('click', () => this.toggleMeasureMode());
        this.elements.btnClearMeasure.addEventListener('click', () => this.clearMeasurement());

        if (this.elements.btnSecret) {
            this.elements.btnSecret.addEventListener('click', () => this.toggleMinecraftMode());
            this.elements.btnSecret.addEventListener('mouseenter', () => this.elements.btnSecret.style.opacity = '0.8');
            this.elements.btnSecret.addEventListener('mouseleave', () => {
                this.elements.btnSecret.style.opacity = this.minecraftMode ? '1' : '0.3';
            });
        }
        window.addEventListener('keydown', (e) => { if (this.minecraftMode) this.handleMinecraftMove(e); });
        
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.addEventListener('click', () => {
                const debugLog = document.getElementById('debug-log');
                if (debugLog) debugLog.classList.toggle('hidden');
            });
        }

        this.elements.propsContent.addEventListener('click', async (e) => {
            const copyIcon = e.target.closest('.copy-icon');
            if (!copyIcon) return;
            const value = copyIcon.getAttribute('data-value');
            if (!value) return;
            try {
                await navigator.clipboard.writeText(value);
                const original = copyIcon.textContent;
                copyIcon.textContent = '✅';
                setTimeout(() => { copyIcon.textContent = original; }, 1500);
            } catch (err) { console.error('Copy failed:', err); }
        });

        const treeBtn = document.getElementById('toggle-tree-btn');
        const treePanel = document.getElementById('tree-panel');

        const updateTreeBtnState = () => {
            if (treePanel.classList.contains('hidden')) {
                treeBtn.style.background = '';
                treeBtn.style.color = '';
                treeBtn.style.borderColor = '';
            } else {
                treeBtn.style.background = '#ffc107';
                treeBtn.style.color = '#000';
                treeBtn.style.borderColor = '#ffc107';
            }
        };

        treeBtn.onclick = () => {
            treePanel.classList.toggle('hidden');
            updateTreeBtnState();
        };
        document.getElementById('close-tree').onclick = () => {
            treePanel.classList.add('hidden');
            updateTreeBtnState();
        };

        document.getElementById('screenshot-btn').onclick = () => this.takeScreenshot();

        const indexBtn = document.getElementById('btn-index-data');
        if (indexBtn) {
            indexBtn.onclick = null;
            indexBtn.onclick = () => {
                this.log('>>> Кнопка индексации нажата');
                this.startIndexing();
            };
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const changed = this.controls.update();
        
        if (changed || this.needsUpdate) {
            this.renderer.render(this.scene, this.camera);
            if (this.cubeRenderer) {
                this.cubeCamera.position.copy(this.camera.position).sub(this.controls.target).setLength(6);
                this.cubeCamera.lookAt(0, 0, 0);
                this.cubeRenderer.render(this.cubeScene, this.cubeCamera);
            }
            this.needsUpdate = false;
        }
    }

    onResize() {
        const width = this.elements.container.clientWidth || window.innerWidth;
        const height = this.elements.container.clientHeight || window.innerHeight;

        if (!this.isOrthographic) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(width, height);
        this.needsUpdate = true;
    }

    toggleMinecraftMode() {
        this.minecraftMode = !this.minecraftMode;
        if (this.messageTimeout) clearTimeout(this.messageTimeout);

        if (this.minecraftMode) {
            this.elements.hardhatOverlay.style.display = 'block';
            setTimeout(() => {
                this.elements.hardhatOverlay.classList.add('active');
                this.elements.hardhatMessage.classList.add('show');
            }, 10);
            this.messageTimeout = setTimeout(() => {
                this.elements.hardhatMessage.classList.remove('show');
            }, 4000);
            this.elements.btnSecret.style.opacity = '1';
            this.setStatus("👷 Режим прораба активен");
        } else {
            this.elements.hardhatMessage.classList.remove('show');
            this.elements.hardhatOverlay.classList.remove('active');
            setTimeout(() => this.elements.hardhatOverlay.style.display = 'none', 400);
            this.elements.btnSecret.style.opacity = '0.3';
            this.setStatus("Стандартная камера");
        }
    }

    handleMinecraftMove(e) {
        if (document.activeElement.tagName === 'INPUT') return;
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        const cross = new THREE.Vector3().crossVectors(this.camera.up, dir).normalize();

        if (e.code === 'KeyW' || e.code === 'ArrowUp') {
            this.camera.position.addScaledVector(dir, CONFIG.WALK_SPEED);
            this.controls.target.addScaledVector(dir, CONFIG.WALK_SPEED);
        }
        if (e.code === 'KeyS' || e.code === 'ArrowDown') {
            this.camera.position.addScaledVector(dir, -CONFIG.WALK_SPEED);
            this.controls.target.addScaledVector(dir, -CONFIG.WALK_SPEED);
        }
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
            this.camera.position.addScaledVector(cross, CONFIG.WALK_SPEED);
            this.controls.target.addScaledVector(cross, CONFIG.WALK_SPEED);
        }
        if (e.code === 'KeyD' || e.code === 'ArrowRight') {
            this.camera.position.addScaledVector(cross, -CONFIG.WALK_SPEED);
            this.controls.target.addScaledVector(cross, -CONFIG.WALK_SPEED);
        }
        if (e.code === 'KeyE') {
            this.camera.position.y += CONFIG.WALK_SPEED;
            this.controls.target.y += CONFIG.WALK_SPEED;
        }
        if (e.code === 'KeyQ') {
            this.camera.position.y -= CONFIG.WALK_SPEED;
            this.controls.target.y -= CONFIG.WALK_SPEED;
        }
        
        this.controls.update();
        this.needsUpdate = true;
    }

    toggleMeasureMode() {
        this.measureMode = !this.measureMode;
        this.elements.btnMeasure.classList.toggle('btn-active', this.measureMode);
        
        if (this.measureMode) {
            this.elements.panelMeasure.classList.remove('hidden');
            this.setStatus("📏 Рулетка активна. Одиночный клик для замера.");
            this.updateMeasureUI();
        } else {
            this.elements.panelMeasure.classList.add('hidden');
            this.clearMeasurement();
            this.setStatus("Рулетка отключена");
        }
    }

    addMeasurePoint(point) {
        if (this.measurePoints.length >= 2) this.clearMeasurement();

        const geo = new THREE.SphereGeometry(0.1, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: this.measurePoints.length === 0 ? CONFIG.COLOR_POINT_1 : CONFIG.COLOR_POINT_2,
            depthTest: false
        });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.position.copy(point);
        this.measureGroup.add(sphere);
        this.measurePoints.push(point);

        if (this.measurePoints.length === 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(this.measurePoints);
            const lineMat = new THREE.LineDashedMaterial({
                color: CONFIG.COLOR_MEASURE_LINE,
                dashSize: 0.2,
                gapSize: 0.1,
                depthTest: false,
                linewidth: 2
            });
            const line = new THREE.Line(lineGeo, lineMat);
            line.computeLineDistances();
            this.measureGroup.add(line);
        }

        this.updateMeasureUI();
        this.needsUpdate = true;
    }

    clearMeasurement() {
        while(this.measureGroup.children.length > 0) {
            const child = this.measureGroup.children[0];
            this.deepDispose(child);
            this.measureGroup.remove(child);
        }
        this.measurePoints = [];
        this.updateMeasureUI();
        this.needsUpdate = true;
    }

    updateMeasureUI() {
        const res = this.elements.measureResults;
        if (this.measurePoints.length === 0) {
            res.innerHTML = "<em>Жду точку 1...</em>";
        } else if (this.measurePoints.length === 1) {
            res.innerHTML = `<div>Точка 1: Установлена</div><em>Жду точку 2...</em>`;
        } else {
            const p1 = this.measurePoints[0];
            const p2 = this.measurePoints[1];
            const dX = Math.abs(p2.x - p1.x).toFixed(3);
            const dY = Math.abs(p2.y - p1.y).toFixed(3);
            const dZ = Math.abs(p2.z - p1.z).toFixed(3);
            const dist = p1.distanceTo(p2).toFixed(3);
            res.innerHTML = `
                <div class="measure-row"><span class="axis-x">ΔX (Длина):</span> <span>${dX} м</span></div>
                <div class="measure-row"><span class="axis-y">ΔY (Высота):</span> <span>${dY} м</span></div>
                <div class="measure-row"><span class="axis-z">ΔZ (Ширина):</span> <span>${dZ} м</span></div>
                <span class="axis-total">Абсолют: ${dist} м</span>
            `;
        }
    }

    async onDoubleClick(e) {
        if (e.target.tagName !== 'CANVAS' || this.measureMode) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Извлекаем сами mesh-объекты из loadedModels
        const visibleMeshes = Array.from(this.loadedModels.values())
            .filter(m => m.visible)
            .map(m => m.mesh);
        const hits = this.raycaster.intersectObjects(visibleMeshes);
        
        if (hits.length > 0) {
            const hit = hits[0];
            this.clearHighlights();
            this.currentSelected.modelId = hit.object.modelID;
            this.currentSelected.id = this.loader.ifcManager.getExpressId(hit.object.geometry, hit.faceIndex);
            this.loader.ifcManager.createSubset({
                modelID: this.currentSelected.modelId,
                ids: [this.currentSelected.id],
                material: this.highlightMaterial,
                scene: this.scene,
                removePrevious: true,
                customId: 'highlight'
            });
            
            this.controls.target.copy(hits[0].point);
            this.controls.update();
            this.needsUpdate = true;
            
            await this.showProperties(this.currentSelected.modelId, this.currentSelected.id);
            this.needsUpdate = true;
        } else {
            this.hideProps();
        }
    }

    setQualityMode(mode) {
        this.elements.btnModeSport.style.border = "1px solid var(--border)";
        this.elements.btnModeBalance.style.border = "1px solid var(--border)";
        this.elements.btnModeBeauty.style.border = "1px solid var(--border)";
        if (mode === 0) {
            this.elements.btnModeSport.style.border = "2px solid #333";
            this.setStatus("Спорт: базовая графика, макс. FPS");
            this.renderer.setPixelRatio(1.0);
            this.renderer.shadowMap.enabled = false;
            if (this.dirLight) this.dirLight.visible = false;
            this.ambientLight.intensity = 1.5;
        } else if (mode === 1) {
            this.elements.btnModeBalance.style.border = "2px solid #333";
            this.setStatus("Баланс: оптимальные настройки");
            this.renderer.setPixelRatio(1.0);
            this.renderer.shadowMap.enabled = true;
            if (this.dirLight) this.dirLight.visible = true;
            this.ambientLight.intensity = 1.2;
        } else {
            this.elements.btnModeBeauty.style.border = "2px solid #333";
            this.setStatus("Краса: поддержка Retina, тени");
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.shadowMap.enabled = true;
            if (this.dirLight) this.dirLight.visible = true;
            this.ambientLight.intensity = 1.2;
        }
        this.needsUpdate = true;
    }

    toggleSectionPanel() {
        this.sectionMode = !this.sectionMode;
        this.elements.btnSection.classList.toggle('btn-active', this.sectionMode);
        this.renderer.localClippingEnabled = this.sectionMode;
        this.loadedModels.forEach(model => {
            model.traverse(node => {
                if (node.isMesh && node.material) {
                    const materials = Array.isArray(node.material) ? node.material : [node.material];
                    materials.forEach(mat => mat.needsUpdate = true);
                }
            });
        });
        if (this.sectionMode) {
            this.calcBoundingBox();
            this.elements.panelSection.classList.remove('hidden');
        } else {
            this.elements.panelSection.classList.add('hidden');
            this.elements.checkY.checked = false;
            this.elements.checkX.checked = false;
        }
        this.applyClipping();
    }

    calcBoundingBox() {
        this.boxLimits.makeEmpty();
        this.loadedModels.forEach(m => { if(m.visible) this.boxLimits.expandByObject(m); });
        if (!this.boxLimits.isEmpty()) {
            this.elements.rangeY.min = this.boxLimits.min.y;
            this.elements.rangeY.max = this.boxLimits.max.y;
            if (!this.elements.checkY.checked) this.elements.rangeY.value = this.boxLimits.max.y;
            this.planeY.constant = parseFloat(this.elements.rangeY.value);
            this.elements.rangeX.min = this.boxLimits.min.x;
            this.elements.rangeX.max = this.boxLimits.max.x;
            if (!this.elements.checkX.checked) this.elements.rangeX.value = this.boxLimits.max.x;
            this.planeX.constant = parseFloat(this.elements.rangeX.value);
        }
    }

    applyClipping() {
        const activePlanes = [];
        if (this.sectionMode) {
            if (this.elements.checkY.checked) {
                activePlanes.push(this.planeY);
                this.elements.rangeY.classList.remove('hidden');
            } else {
                this.elements.rangeY.classList.add('hidden');
            }
            if (this.elements.checkX.checked) {
                activePlanes.push(this.planeX);
                this.elements.rangeX.classList.remove('hidden');
            } else {
                this.elements.rangeX.classList.add('hidden');
            }
        }
        this.loadedModels.forEach(model => {
            model.traverse(node => {
                if (node.isMesh && node.material) {
                    const materials = Array.isArray(node.material) ? node.material : [node.material];
                    materials.forEach(mat => {
                        mat.clippingPlanes = activePlanes.length > 0 ? activePlanes : null;
                        mat.clipShadows = true;
                    });
                }
            });
        });
        this.needsUpdate = true;
    }

    async toggleSpacesMode() {
        this.spacesMode = !this.spacesMode;
        const wrapper = document.getElementById('space-search-wrapper');
        if (this.spacesMode) {
            this.elements.btnSpaces.textContent = "📦 ПОМЕЩЕНИЯ: ВКЛ";
            this.elements.btnSpaces.classList.add('btn-primary');
            wrapper.classList.remove('hidden');
            this.setStatus("Индексация...");
            await this.indexSpaces();
            this.initSpaceSearch();
        } else {
            this.elements.btnSpaces.textContent = "📦 ПОМЕЩЕНИЯ";
            this.elements.btnSpaces.classList.remove('btn-primary');
            wrapper.classList.add('hidden');
            this.allSpaces = [];
        }
    }

    async indexSpaces() {
        this.allSpaces = [];
        for (const [name, modelData] of this.loadedModels) {
            if (!modelData || !modelData.mesh) continue;
            
            try {
                const ids = await this.loader.ifcManager.getAllItemsOfType(modelData.modelID, 'IFCSPACE', false);
                for (const id of ids) {
                    const props = await this.getSafeProperties(modelData.modelID, id);
                    this.allSpaces.push({
                        modelID: modelData.modelID,
                        id: id,
                        name: props?.Name?.value || props?.LongName?.value || `ID ${id}`
                    });
                }
            } catch (e) {
                this.log(`⚠️ Ошибка индексации помещений в ${name}: ${e.message}`);
            }
        }
        this.setStatus(`Найдено помещений: ${this.allSpaces.length}`);
    }

    initSpaceSearch() {
        const input = document.getElementById('space-search');
        const results = document.getElementById('spaces-results');
        input.oninput = () => {
            const val = input.value.toLowerCase();
            results.innerHTML = '';
            if (val.length < 2) { results.classList.add('hidden'); return; }
            const filtered = this.allSpaces.filter(s => s.name.toLowerCase().includes(val)).slice(0, 10);
            if (filtered.length > 0) {
                results.classList.remove('hidden');
                filtered.forEach(s => {
                    const div = document.createElement('div');
                    div.className = 'space-item-result';
                    div.textContent = s.name;
                    div.onclick = () => {
                        this.zoomToSpace(s.modelID, s.id);
                        results.classList.add('hidden');
                        input.value = s.name;
                    };
                    results.appendChild(div);
                });
            }
        };
    }

    async zoomToSpace(modelID, expressID) {
        const subset = this.loader.ifcManager.createSubset({
            modelID: modelID,
            ids: [expressID],
            scene: this.scene,
            removePrevious: true,
            customId: 'zoom_temp'
        });
        if (!subset) return;
        const box = new THREE.Box3().setFromObject(subset);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const offset = Math.max(size.x, size.y, size.z) * 1.5;
        this.controls.target.copy(center);
        this.camera.position.set(center.x + offset, center.y + offset, center.z + offset);
        this.controls.update();
        this.needsUpdate = true;
        setTimeout(() => {
            this.loader.ifcManager.removeSubset(modelID, undefined, 'zoom_temp');
            this.needsUpdate = true;
        }, 1000);
    }

    async handleUpload(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        this.setStatus(`Загрузка ${files.length} файлов...`);
        for (const file of files) {
            this.setStatus(`Парсинг: ${file.name}...`);
            await new Promise(r => setTimeout(r, 100));
            try {
                const url = URL.createObjectURL(new Blob([await file.arrayBuffer()]));
                const m = await this.loader.loadAsync(url);
                m.name = file.name;
                
                // Сохраняем модель как объект с явным разделением mesh и modelID
                const modelData = {
                    mesh: m,
                    modelID: m.modelID,
                    visible: true
                };
                
                this.scene.add(m);
                this.loadedModels.set(file.name, modelData);
                URL.revokeObjectURL(url);
                
                if (this.sectionMode) { this.calcBoundingBox(); this.applyClipping(); }
                this.renderLocalList();
                this.needsUpdate = true;
                
                // Строим дерево для загруженной модели
                this.log(`Построение дерева для ${file.name}...`);
                await this.buildProjectTree(m.modelID, file.name);
            } catch (e) {
                this.log(`⚠️ Ошибка загрузки ${file.name}: ${e.message}`);
                console.error(`Ошибка: ${file.name}`, e);
            }
        }
        if (this.spacesMode) await this.indexSpaces();
        this.fitCamera();
        this.setStatus(`Сборка обновлена. Моделей: ${this.loadedModels.size}`);
        event.target.value = '';
    }

    renderLocalList() {
        const list = this.elements.modelsList;
        list.innerHTML = '';
        if (!this.loadedModels.size) {
            list.innerHTML = '<div style="font-size:11px;color:#999;padding:5px 0;">Сборка пуста</div>';
            return;
        }
        this.loadedModels.forEach((modelData, name) => {
            const item = document.createElement('div');
            item.className = 'model-item';
            // modelData - это объект {mesh, modelID, visible}
            const isVis = modelData.visible;
            const visIcon = isVis ? '👁️' : '🕶️';
            const visStyle = isVis ? '' : 'text-decoration:line-through;opacity:0.5;';
            item.innerHTML = `
                <div class="model-name" title="${name}" style="${visStyle}">${name}</div>
                <div class="model-actions">
                    <button class="icon-btn btn-vis">${visIcon}</button>
                    <button class="icon-btn btn-del" style="color:#d93025;">🗑️</button>
                </div>
            `;
            item.querySelector('.btn-vis').addEventListener('click', () => this.toggleModelVis(name));
            item.querySelector('.btn-del').addEventListener('click', () => this.unloadModel(name));
            list.appendChild(item);
        });
    }

    unloadModel(name) {
        const modelData = this.loadedModels.get(name);
        if(modelData) {
            const m = modelData.mesh;
            this.loader.ifcManager.close(modelData.modelID, this.scene);
            this.scene.remove(m);
            this.deepDispose(m);
            this.loadedModels.delete(name);
            this.clearHighlights();
            this.hideProps();
            this.renderLocalList();
            if (this.sectionMode) this.calcBoundingBox();
            this.setStatus(`Удалено: ${name}`);
            this.needsUpdate = true;
        }
    }

    deepDispose(obj) {
        if (!obj) return;
        obj.traverse((node) => {
            if (node.isMesh) {
                if (node.geometry) node.geometry.dispose();
                if (node.material) {
                    Array.isArray(node.material) ? node.material.forEach(m => m.dispose()) : node.material.dispose();
                }
            }
        });
    }

    clearHighlights() {
        if (this.currentSelected.modelId !== null) {
            this.loader.ifcManager.removeSubset(this.currentSelected.modelId, this.highlightMaterial, 'highlight');
            this.currentSelected = { id: null, modelId: null };
            this.needsUpdate = true;
        }
    }

    async showProperties(modelID, id) {
        const [props, psets] = await Promise.all([
            this.getSafeProperties(modelID, id),
            this.getSafePropertySets(modelID, id)
        ]);

        let h = `<div class="prop-group-title">Идентификация</div>
                  <div class="prop-row"><span class="prop-name">ID</span><span class="prop-val">${id}</span></div>`;
        
        if (props) {
            ['Name', 'ObjectType', 'Tag'].forEach(k => {
                if (props[k]) {
                    const val = (props[k].value || props[k]);
                    h += `<div class="prop-row"><span class="prop-name">${k}</span><span class="prop-val">${val} <span class="copy-icon" data-value="${val}" title="Копировать">📋</span></span></div>`;
                }
            });
        }
        
        if (psets && psets.length > 0) {
            psets.forEach(ps => {
                if (!ps.HasProperties?.length) return;
                h += `<div class="prop-group-title">${ps.Name?.value || 'PSet'}</div>`;
                ps.HasProperties.forEach(p => {
                    const val = (p.NominalValue?.value || '-');
                    h += `<div class="prop-row"><span class="prop-name">${p.Name?.value || 'Property'}</span><span class="prop-val">${val} <span class="copy-icon" data-value="${val}" title="Копировать">📋</span></span></div>`;
                });
            });
        }
        
        this.elements.propsContent.innerHTML = h;
        this.elements.propsPanel.classList.remove('hidden');
    }

    async loadDefault() {
        this.renderServerModels();
        this.setStatus("Выберите модель для загрузки");
        this.log('Default load canceled, showing server models');
        this.needsUpdate = true;
    }

    async buildProjectTree(modelID, modelName) {
        this.log(`ЗАПРОС: Пространственной структуры для модели ${modelID} (${modelName})...`);
        const manager = this.loader.ifcManager;
        const treeContent = document.getElementById('tree-content');
        if (!treeContent) {
            this.log('ОШИБКА: DOM-контейнер дерева не найден!');
            return;
        }
        
        treeContent.innerHTML = '';
        
        try {
            const project = await manager.getSpatialStructure(modelID);
            if (!project) return;

            const createNode = async (node, currentModelID, currentModelName) => {
                const div = document.createElement('div');
                div.className = 'tree-node';
                
                // Добавляем modelID и modelName в атрибуты для мультимодельности
                div.setAttribute('data-model-id', currentModelID);
                div.setAttribute('data-model-name', currentModelName);
                
                const name = typeof getHumanName === 'function' ? 
                    await getHumanName(manager, currentModelID, node.expressID, node.type) : 
                    (node.name || node.type || `ID ${node.expressID}`);
                    
                div.setAttribute('data-name', name.toLowerCase());
                div.setAttribute('data-id', node.expressID);

                const titleDiv = document.createElement('div');
                titleDiv.className = 'tree-node-title';
                
                titleDiv.innerHTML = `
                    <span class="tree-toggle" style="cursor: pointer;">${node.children && node.children.length > 0 ? '▶' : '&nbsp;'}</span>
                    <span class="tree-name" style="cursor: pointer;">${name} <small>[${node.type}]</small></span>
                    <span class="tree-eye" style="cursor: pointer;">👁️</span>
                `;

                titleDiv.querySelector('.tree-name').onclick = async () => {
                    if (typeof this.focusOnElement === 'function') this.focusOnElement(currentModelID, node.expressID);
                    if (typeof this.showProperties === 'function') await this.showProperties(currentModelID, node.expressID);
                };

                const eye = titleDiv.querySelector('.tree-eye');
                eye.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof this.toggleVisibility === 'function') this.toggleVisibility(currentModelID, node, eye);
                };

                div.appendChild(titleDiv);

                if (node.children && node.children.length > 0) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'node-children';
                    childrenContainer.style.display = 'none';
                    
                    titleDiv.querySelector('.tree-toggle').onclick = () => {
                        const isHidden = childrenContainer.style.display === 'none';
                        childrenContainer.style.display = isHidden ? 'block' : 'none';
                        titleDiv.querySelector('.tree-toggle').textContent = isHidden ? '▼' : '▶';
                    };

                    for (const child of node.children) {
                        childrenContainer.appendChild(await createNode(child, currentModelID, currentModelName));
                    }
                    div.appendChild(childrenContainer);
                }
                return div;
            };

            treeContent.appendChild(await createNode(project, modelID, modelName));
            this.log('Дерево построено. Интерактивность восстановлена.');

            const searchInput = document.getElementById('tree-search');
            if (searchInput) {
                searchInput.oninput = (e) => {
                    const val = e.target.value.toLowerCase();
                    document.querySelectorAll('.tree-node').forEach(el => {
                        const isMatch = 
                            el.getAttribute('data-name')?.includes(val) || 
                            el.getAttribute('data-id')?.includes(val) ||
                            (el.getAttribute('data-system') && el.getAttribute('data-system').includes(val)) ||
                            (el.getAttribute('data-family') && el.getAttribute('data-family').includes(val));
                        
                        el.style.display = isMatch ? 'block' : 'none';
                        
                        if (isMatch) {
                            let parent = el.parentElement.closest('.tree-node');
                            while (parent) {
                                parent.style.display = 'block';
                                const children = parent.querySelector('.node-children');
                                if (children) children.style.display = 'block';
                                parent = parent.parentElement?.closest('.tree-node');
                            }
                        }
                    });
                };
            }
        } catch (e) {
            this.log('ОШИБКА сборки дерева: ' + e.message);
        }
    }

    focusOnElement(modelID, expressID) {
        const manager = this.loader.ifcManager;
        const subset = manager.createSubset({
            modelID: modelID,
            ids: [expressID],
            removePrevious: true,
            customID: 'focus-temp'
        });
        
        if (subset) {
            subset.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            subset.geometry.boundingBox.getCenter(center);
            
            this.controls.target.copy(center);
            const offset = 5;
            this.camera.position.set(center.x + offset, center.y + offset, center.z + offset);
            this.controls.update();
            this.needsUpdate = true;
            
            setTimeout(() => {
                manager.removeSubset(modelID, undefined, 'focus-temp');
            }, 2000);
        }
    }

 async startIndexing() {
    const btn = document.getElementById('btn-index-data');
    const progressText = document.getElementById('index-progress');
    const manager = this.loader.ifcManager;

    if (this.loadedModels.size === 0) {
        this.log('⚠️ Нет загруженных моделей для индексации');
        return;
    }

    btn.disabled = true;
    btn.textContent = '🚀 Qwen-индексация...';
    progressText.style.display = 'block';
    progressText.textContent = 'Сканирование всех моделей...';
    await new Promise(r => setTimeout(r, 50));

    let totalSystemsFound = 0;
    const indexDataGlobal = {}; // Хранилище для всех моделей

    try {
        // Проходим по каждой загруженной модели (исправляем итерацию Map)
        for (const [modelName, modelData] of this.loadedModels.entries()) {
            const modelID = modelData.modelID;
            
            this.log(`🔍 Обработка модели: ${modelName} (ID: ${modelID})`);
            progressText.textContent = `Модель: ${modelName.substring(0, 20)}...`;

            const cacheKey = 'bim_index_' + modelID;
            localStorage.removeItem(cacheKey);
            const indexData = {};

            // ШАГ 1: Пытаемся получить граф свойств через IFCRELDEFINESBYPROPERTIES
            let allProps = null;
            
            if (typeof manager.getAllProperties === 'function') {
                try {
                    allProps = await manager.getAllProperties(modelID);
                    if (!allProps || (allProps instanceof Map && allProps.size === 0)) {
                        allProps = null;
                    }
                } catch (e) {
                    this.log(`⚠️ getAllProperties ошибся: ${e.message}`);
                    allProps = null;
                }
            }
            
            if (!allProps) {
                // Ручной сбор связей
                allProps = new Map();
                try {
                    const rels = await manager.getAllItemsOfType(modelID, 'IFCRELDEFINESBYPROPERTIES', false);
                    this.log(`📦 Найдено связей IFCRELDEFINESBYPROPERTIES: ${rels.length}`);
                    
                    for (const relID of rels) {
                        const rel = await manager.getItemProperties(modelID, relID);
                        if (!rel || !rel.RelatingPropertyDefinition || !rel.RelatedObjects) continue;
                        
                        const pset = await manager.getItemProperties(modelID, rel.RelatingPropertyDefinition.value);
                        if (!pset || !pset.HasProperties) continue;
                        
                        const fullPset = { ...pset, HasProperties: [] };
                        for (const propRef of pset.HasProperties) {
                            fullPset.HasProperties.push(await manager.getItemProperties(modelID, propRef.value));
                        }
                        
                        for (const objRef of rel.RelatedObjects) {
                            const elemID = objRef.value;
                            if (!allProps.has(elemID)) allProps.set(elemID, []);
                            allProps.get(elemID).push(fullPset);
                        }
                    }
                } catch (e) {
                    this.log(`⚠️ Ошибка ручного сбора: ${e.message}`);
                }
            }

            // ШАГ 2: Парсинг Psets для поиска System Name
            for (const [expressID, pSets] of allProps.entries()) {
                if (!pSets || !Array.isArray(pSets)) continue;

                let sysName = null;
                for (const pSet of pSets) {
                    const props = pSet.HasProperties || [];
                    for (const p of props) {
                        const rawName = p.Name?.value || p.Name || '';
                        const val = p.NominalValue?.value ?? null;
                        if (!rawName || val === null) continue;

                        const name = rawName.toLowerCase();
                        if (name.includes('system') || name.includes('система') || name.includes('pset_system')) {
                            const cleaned = this.cleanSystemName(String(val));
                            if (cleaned) {
                                sysName = cleaned;
                                break;
                            }
                        }
                    }
                    if (sysName) break;
                }

                if (sysName) {
                    indexData[expressID] = { s: sysName };
                }
            }

            // ШАГ 3: Fallback - прямое чтение свойств Name/Tag/ObjectType у элементов без Psets
            const indexedIds = new Set(Object.keys(indexData).map(Number));
            let directReadCount = 0;
            
            // Собираем все ExpressIDs из дерева для этой модели (используем data-id)
            const modelTreeNodes = document.querySelectorAll(`.tree-node[data-model-id="${modelID}"]`);
            const treeExpressIds = Array.from(modelTreeNodes)
                .map(node => parseInt(node.getAttribute('data-id')))
                .filter(id => !isNaN(id) && !indexedIds.has(id));
            
            this.log(`🔍 Прямое сканирование ${treeExpressIds.length} элементов без Psets...`);
            
            for (const expressID of treeExpressIds) {
                try {
                    // Пробуем прочитать Name напрямую
                    const elemProps = await manager.getItemProperties(modelID, expressID, false);
                    if (elemProps && elemProps.Name) {
                        const nameVal = elemProps.Name.value || elemProps.Name;
                        if (nameVal && typeof nameVal === 'string' && nameVal.trim().length > 2 && !nameVal.startsWith('Ifc')) {
                            const cleaned = this.cleanSystemName(nameVal.trim());
                            if (cleaned) {
                                indexData[expressID] = { s: cleaned };
                                directReadCount++;
                                continue;
                            }
                        }
                    }
                    
                    // Если Name не подошел, пробуем Tag
                    if (!indexData[expressID] && elemProps && elemProps.Tag) {
                        const tagVal = elemProps.Tag.value || elemProps.Tag;
                        if (tagVal && typeof tagVal === 'string' && tagVal.trim().length > 2) {
                            const cleaned = this.cleanSystemName(tagVal.trim());
                            if (cleaned) {
                                indexData[expressID] = { s: cleaned };
                                directReadCount++;
                                continue;
                            }
                        }
                    }
                    
                    // Пробуем ObjectType
                    if (!indexData[expressID] && elemProps && elemProps.ObjectType) {
                        const typeVal = elemProps.ObjectType.value || elemProps.ObjectType;
                        if (typeVal && typeof typeVal === 'string' && typeVal.trim().length > 2) {
                            const cleaned = this.cleanSystemName(typeVal.trim());
                            if (cleaned) {
                                indexData[expressID] = { s: cleaned };
                                directReadCount++;
                                continue;
                            }
                        }
                    }
                } catch (e) {
                    // Игнорируем ошибки чтения отдельных элементов
                }
                
                // Yield каждые 500 элементов чтобы не блокировать UI
                if (directReadCount % 500 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            
            this.log(`✅ Модель ${modelID}: найдено систем ${Object.keys(indexData).length} (из Psets + ${directReadCount} прямых)`);
            totalSystemsFound += Object.keys(indexData).length;

            // ШАГ 4: Применяем к узлам дерева ЭТОЙ модели
            let appliedCount = 0;
            const nodes = document.querySelectorAll(`.tree-node[data-model-id="${modelID}"]`);
            nodes.forEach(node => {
                const id = parseInt(node.getAttribute('data-id'));
                if (indexData[id] && indexData[id].s) {
                    node.setAttribute('data-system', indexData[id].s);
                    appliedCount++;
                }
            });
            
            this.log(`📊 Применено к узлам дерева: ${appliedCount}`);
            
            // Кэшируем
            try { localStorage.setItem(cacheKey, JSON.stringify(indexData)); } catch(e) {}
            
            indexDataGlobal[modelID] = indexData;
        }

        this.log(`🎉 ИНДЕКСАЦИЯ ЗАВЕРШЕНА. Всего систем: ${totalSystemsFound}`);
        progressText.textContent = '✅ Готово';

    } catch (e) {
        console.error("Ошибка индексации:", e);
        this.log("❌ ОШИБКА: " + e.message);
        progressText.textContent = '❌ Ошибка';
    }

    this.finishIndexingUI(btn, progressText, '✅ Индексация завершена');
    this.renderSystemsList();
}

/**
 * Очистка и нормализация имени системы
 * Отсекает GUID, технические суффиксы и приводит к единому виду
 */
cleanSystemName(rawName) {
    if (!rawName || typeof rawName !== 'string') return null;
    
    let name = rawName.trim();
    
    // 1. Удаляем хвосты вида :1234567 (Revit Element ID)
    // Пример: "В1 137:1945891" -> "В1 137"
    name = name.replace(/:\d+$/, '');
    
    // 2. Удаляем префиксы семейств fa:, id: и т.д.
    // Пример: "fa:В1 137" -> "В1 137"
    name = name.replace(/^(fa|id|guid):/i, '');
    
    // 3. Если строка начинается с мусорных символов (скобки, спецсимволы) - обрезаем
    // Пример: "013G1679):СТАНДАРТ:..." -> отбрасываем полностью если нет полезного начала
    if (/^\w+\):/.test(name)) {
        // Пытаемся вытащить часть после двоеточия, если там есть кириллица или буквы
        const parts = name.split(':');
        const usefulPart = parts.find(p => /[а-яА-Яa-zA-Z]/.test(p) && !/STANDARD|GUID/i.test(p));
        if (usefulPart) name = usefulPart.trim();
        else return null;
    }
    
    // 4. Удаляем лишние пробелы, возникшие после чистки
    name = name.replace(/\s+/g, ' ').trim();
    
    // 5. Фильтруем явный мусор
    if (name.length < 2 || name === '0' || name === 'System') return null;
    
    // 6. Фильтр GUID-подобных строк
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(name)) return null;
    
    return name;
}

    finishIndexingUI(btn, progressText, message) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = message;
        btn.style.borderColor = '#4CAF50';
        btn.style.color = '#4CAF50';
        btn.style.background = 'transparent';
        progressText.textContent = 'Готово!';
        setTimeout(() => { progressText.style.display = 'none'; }, 3000);
    }

    renderSystemsList() {
        this.log('🔍 renderSystemsList: начало выполнения...');
        
        // Проверка наличия контейнера, создание если нет
        let container = document.getElementById('systems-container');
        if (!container) {
            const btnIndex = document.getElementById('btn-index-data');
            if (!btnIndex) {
                this.log('⚠️ Кнопка индексации не найдена, пропускаем создание контейнера систем');
                return;
            }
            
            // Создаем контейнер динамически
            container = document.createElement('div');
            container.id = 'systems-container';
            container.style.cssText = 'padding: 0 10px 10px 10px; display: none;';
            container.innerHTML = `
                <div style="font-size: 11px; color: var(--ink3); margin-bottom: 8px;">НАЙДЕННЫЕ СИСТЕМЫ:</div>
                <div id="systems-list" style="display: flex; flex-wrap: wrap; gap: 5px;"></div>
            `;
            btnIndex.parentNode.insertBefore(container, btnIndex.nextSibling);
            this.log('✅ Динамически создан контейнер #systems-container');
        }
        
        const list = document.getElementById('systems-list');
        if (!list) {
            this.log('⚠️ Контейнер #systems-list не найден внутри #systems-container');
            return;
        }
        
        const nodes = document.querySelectorAll('.tree-node[data-system]');
        this.log(`📊 Найдено узлов с data-system: ${nodes.length}`);
        
        const systems = new Set();
        
        nodes.forEach(node => {
            const sys = node.getAttribute('data-system');
            if (sys && sys.trim() !== '') {
                sys.split(',').forEach(s => systems.add(s.trim()));
            }
        });

        this.log(`🏷️ Уникальных систем найдено: ${systems.size}`);
        list.innerHTML = '';

        if (systems.size === 0) {
            container.style.display = 'none';
            this.log('⚠️ Системы не найдены, скрываем контейнер');
            return;
        }

        // Сортировка по алфавиту
        const sortedSystems = Array.from(systems).sort((a, b) => a.localeCompare(b));
        this.log(`📋 Отсортированные системы: ${sortedSystems.join(', ')}`);

        sortedSystems.forEach(sys => {
            const btn = document.createElement('button');
            btn.className = 'system-tag';
            btn.textContent = sys.toUpperCase();
            btn.onclick = () => this.toggleSystemIsolation(sys, btn);
            list.appendChild(btn);
        });

        container.style.display = 'block';
        this.log('✅ Контейнер систем отображен');
    }

    toggleSystemIsolation(systemName, btnElement) {
        const isActive = btnElement.classList.contains('active');
        const allBtns = document.querySelectorAll('.system-tag');
        
        // Сброс всех активных тегов
        allBtns.forEach(b => {
            b.classList.remove('active');
        });

        const manager = this.loader.ifcManager;

        if (isActive) {
            // Деактивация: очистить все subset'ы изоляции и вернуть видимость всем моделям
            this.loadedModels.forEach((modelData, modelName) => {
                if (modelData && modelData.modelID !== undefined) {
                    try {
                        manager.removeSubset(modelData.modelID, undefined, 'system-isolation');
                    } catch (e) {
                        this.log(`⚠️ Ошибка удаления subset для модели ${modelName}: ${e.message}`);
                    }
                    modelData.mesh.visible = true;
                }
            });
            this.log(`🔓 Деактивирована изоляция системы: ${systemName}`);
        } else {
            // Активация
            btnElement.classList.add('active');

            const nodes = document.querySelectorAll('.tree-node');
            const idsByModel = new Map(); // Map<modelID, Array<expressID>>

            // Собираем ID элементов по моделям из дерева
            nodes.forEach(node => {
                const sys = node.getAttribute('data-system');
                if (sys && sys.includes(systemName)) {
                    const modelID = parseInt(node.getAttribute('data-model-id'));
                    const expressID = parseInt(node.getAttribute('data-id'));
                    
                    if (!idsByModel.has(modelID)) {
                        idsByModel.set(modelID, []);
                    }
                    idsByModel.get(modelID).push(expressID);
                }
            });

            if (!this.systemMaterial) {
                this.systemMaterial = new THREE.MeshLambertMaterial({
                    color: 0xffaa00,
                    transparent: true,
                    opacity: 0.8,
                    depthTest: true
                });
            }

            let totalElements = 0;

            // Скрываем все модели и создаем subset только для нужных элементов
            this.loadedModels.forEach((modelData, modelName) => {
                if (modelData && modelData.modelID !== undefined) {
                    const modelID = modelData.modelID;
                    const idsToIsolate = idsByModel.get(modelID) || [];
                    
                    try {
                        if (idsToIsolate.length > 0) {
                            modelData.mesh.visible = false;
                            
                            manager.createSubset({
                                modelID: modelID,
                                ids: idsToIsolate,
                                material: this.systemMaterial,
                                scene: this.scene,
                                removePrevious: true,
                                customID: 'system-isolation'
                            });
                            
                            totalElements += idsToIsolate.length;
                            this.log(`✅ Модель ${modelName}: выделено ${idsToIsolate.length} элементов системы "${systemName}"`);
                        } else {
                            // Если в модели нет элементов этой системы, просто скрываем её
                            modelData.mesh.visible = false;
                            this.log(`ℹ️ Модель ${modelName}: нет элементов системы "${systemName}", скрыта`);
                        }
                    } catch (e) {
                        this.log(`⚠️ Ошибка создания subset для модели ${modelName}: ${e.message}`);
                    }
                }
            });

            this.log(`🔒 Активирована изоляция системы: ${systemName} (всего элементов: ${totalElements})`);
        }
        this.needsUpdate = true;
    }

    toggleVisibility(modelID, node, eyeElement) {
        const manager = this.loader.ifcManager;
        
        // Инициализация Map для модели если нет
        if (!this.hiddenElements.has(modelID)) {
            this.hiddenElements.set(modelID, new Set());
        }
        const modelHiddenSet = this.hiddenElements.get(modelID);

        const idsToToggle = getAllIds(node);
        const isHidden = modelHiddenSet.has(node.expressID);

        if (isHidden) {
            // Показать элементы
            idsToToggle.forEach(id => modelHiddenSet.delete(id));
            eyeElement.style.opacity = '1';
            manager.createSubset({ modelID: modelID, ids: idsToToggle, removePrevious: false });
        } else {
            // Скрыть элементы
            idsToToggle.forEach(id => modelHiddenSet.add(id));
            eyeElement.style.opacity = '0.3';
            manager.removeFromSubset(modelID, idsToToggle);
        }
        this.needsUpdate = true;
    }

    resetVisibility() {
        // Очистка всех скрытых элементов для всех моделей
        this.hiddenElements.clear();
        
        // Восстановление видимости через showAllItems для каждой модели
        this.loadedModels.forEach((modelData, modelName) => {
            if (modelData && modelData.modelID !== undefined) {
                try {
                    this.loader.ifcManager.showAllItems(modelData.modelID);
                } catch (e) {
                    this.log(`⚠️ Ошибка сброса видимости для ${modelName}: ${e.message}`);
                }
            }
        });
        
        this.clearHighlights();
        this.needsUpdate = true;
    }

    renderServerModels() {
        const list = this.elements.modelsList;
        list.innerHTML = '';
        const serverModels = window.SERVER_MODELS || [];
        
        if (serverModels.length === 0) {
            list.innerHTML = '<div style="font-size:11px;color:#999;padding:5px 0;">Нет моделей в папке models</div>';
            return;
        }
        
        serverModels.forEach(name => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.style.margin = '5px 0';
            btn.style.width = '100%';
            btn.textContent = `Загрузить ${name}`;
            btn.addEventListener('click', async () => {
                this.setStatus(`Загрузка ${name}...`);
                this.log(`Скачивание файла: ${name}...`);
                btn.disabled = true;
                btn.textContent = `⏳ Подготовка...`;
                
                try {
                    const response = await fetch(`./models/${name}`);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    
                    const contentLength = response.headers.get('content-length');
                    const totalBytes = contentLength ? parseInt(contentLength) : 0;
                    let loadedBytes = 0;
                    
                    const reader = response.body.getReader();
                    const chunks = [];
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        chunks.push(value);
                        loadedBytes += value.length;
                        
                        const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
                        if (totalBytes > 0) {
                            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                            const percent = Math.round((loadedBytes / totalBytes) * 100);
                            btn.textContent = `⏳ Скачано: ${loadedMB} / ${totalMB} МБ (${percent}%)`;
                        } else {
                            btn.textContent = `⏳ Скачано: ${loadedMB} МБ...`;
                        }
                    }
                    
                    this.log('Файл скачан. Инициализация WASM-ядра...');
                    btn.textContent = `⏳ Парсинг IFC...`;
                    const blob = new Blob(chunks);
                    const url = URL.createObjectURL(blob);
                    
                    this.log('Начало парсинга');
                    const m = await this.loader.loadAsync(url);
                    m.name = name;
                    
                    // Сохраняем модель как объект с явным разделением mesh и modelID
                    const modelData = {
                        mesh: m,
                        modelID: m.modelID,
                        visible: true
                    };
                    
                    this.currentModelName = name;
                    this.currentModelID = m.modelID;
                    this.scene.add(m);
                    this.loadedModels.set(name, modelData);
                    URL.revokeObjectURL(url);
                    
                    this.log('Геометрия построена. Рендеринг 3D-сцены...');
                    this.fitCamera();
                    this.renderLocalList();
                    this.setStatus(`Модель ${name} загружена`);
                    this.needsUpdate = true;
                    btn.textContent = `✅ ${name}`;
                    btn.disabled = false;
                    
                    this.log('Сборка пространственного дерева (Tree)...');
                    await this.buildProjectTree(m.modelID, name);
                    this.log('Дерево построено.');
                } catch (e) {
                    this.setStatus(`Ошибка загрузки ${name}`);
                    this.log(`ОШИБКА загрузки ${name}: ${e.message}`);
                    console.error(e);
                    btn.textContent = `❌ Ошибка: ${name}`;
                    btn.disabled = false;
                }
            });
            list.appendChild(btn);
        });
    }

    initViewCube() {
        const cnt = document.getElementById('viewcube');
        this.cubeScene = new THREE.Scene();
        this.cubeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
        this.cubeCamera.position.set(0, 0, 6);
        this.cubeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.cubeRenderer.setSize(120, 120);
        cnt.appendChild(this.cubeRenderer.domElement);
        
        const cr = (c, r, n) => {
            const g = new THREE.Group();
            g.name = n;
            const c1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.1, 2.2),
                new THREE.MeshBasicMaterial({color:c})
            );
            c1.position.y = 1.1;
            g.add(c1);
            const c2 = new THREE.Mesh(
                new THREE.ConeGeometry(0.25, 0.6),
                new THREE.MeshBasicMaterial({color:c})
            );
            c2.position.y = 2.4;
            g.add(c2);
            g.rotation.set(...r);
            return g;
        };
        
        this.cubeScene.add(
            cr(0xff3e3e, [0, 0, -Math.PI/2], 'x'),
            cr(0x32cd32, [0, 0, 0], 'y'),
            cr(0x1e90ff, [Math.PI/2, 0, 0], 'z')
        );
        
        cnt.addEventListener('click', (e) => {
            const r = cnt.getBoundingClientRect();
            const rc = new THREE.Raycaster();
            rc.setFromCamera({
                x:((e.clientX-r.left)/r.width)*2-1,
                y:-((e.clientY-r.top)/r.height)*2+1
            }, this.cubeCamera);
            const hs = rc.intersectObjects(this.cubeScene.children, true);
            if (hs.length > 0) {
                let o = hs[0].object;
                while(o.parent && !o.name) o = o.parent;
                const d = this.camera.position.distanceTo(this.controls.target);
                if (o.name === 'x') this.camera.position.set(d, 0, 0);
                if (o.name === 'y') this.camera.position.set(0, d, 0);
                if (o.name === 'z') this.camera.position.set(0, 0, d);
                this.camera.lookAt(0,0,0);
                this.controls.update();
                this.needsUpdate = true;
            }
        });
    }

    setStatus(t) { this.elements.status.textContent = t; }
    
    hideProps() {
        this.elements.propsPanel.classList.add('hidden');
        this.clearHighlights();
    }
    
    toggleModelVis(n) {
        const modelData = this.loadedModels.get(n);
        if(modelData) {
            modelData.visible = !modelData.visible;
            modelData.mesh.visible = modelData.visible;
            this.clearHighlights();
            this.renderLocalList();
            this.needsUpdate = true;
        }
    }
    
    toggleXRay() {
        this.xrayMode = !this.xrayMode;
        this.elements.btnXray.classList.toggle('active', this.xrayMode);
        this.loadedModels.forEach(modelData => {
            const m = modelData.mesh;
            const a = (mat) => {
                mat.transparent = this.xrayMode;
                mat.opacity = this.xrayMode ? CONFIG.XRAY_OPACITY : 1;
                mat.needsUpdate = true;
            };
            if (Array.isArray(m.material)) m.material.forEach(a);
            else a(m.material);
        });
        this.needsUpdate = true;
    }
    
    toggleCamera() {
        this.isOrthographic = !this.isOrthographic;
        this.elements.btnCam.classList.toggle('active', this.isOrthographic);
        const aspect = (this.elements.container.clientWidth || window.innerWidth) / (this.elements.container.clientHeight || window.innerHeight);
        const d = 35;
        const p = this.camera.position.clone();
        if (this.isOrthographic) {
            this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 10000);
        } else {
            this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
        }
        this.camera.position.copy(p);
        this.controls.object = this.camera;
        this.controls.update();
        this.needsUpdate = true;
    }
    
    fitCamera() {
        const b = new THREE.Box3();
        this.loadedModels.forEach(modelData => {
            if (modelData && modelData.visible && modelData.mesh) {
                b.expandByObject(modelData.mesh);
            }
        });
        if (b.isEmpty()) return;
        const c = b.getCenter(new THREE.Vector3());
        const s = b.getSize(new THREE.Vector3());
        const z = Math.max(s.x, s.y, s.z)*1.5;
        this.camera.position.set(c.x+z, c.y+z, c.z+z);
        this.controls.target.copy(c);
        this.camera.lookAt(c);
        this.controls.update();
        this.needsUpdate = true;
    }
    
    hideSelectedElement() {
        if (this.currentSelected.id && this.currentSelected.modelId !== null) {
            this.loader.ifcManager.hideItems(this.currentSelected.modelId, [this.currentSelected.id]);
            this.clearHighlights();
            this.hideProps();
            this.needsUpdate = true;
        }
    }
    
    resetVisibility() {
        // Очистка скрытых элементов для всех моделей
        this.hiddenElements.clear();
        
        this.loadedModels.forEach(modelData => {
            if (modelData && modelData.modelID !== undefined) {
                try {
                    this.loader.ifcManager.showAllItems(modelData.modelID);
                } catch (e) {
                    this.log(`⚠️ Ошибка showAllItems: ${e.message}`);
                }
            }
        });
        this.clearHighlights();
        this.needsUpdate = true;
    }

    takeScreenshot() {
        const helperVisible = this.pivotSphere.visible;
        this.pivotSphere.visible = false;

        const originalSize = new THREE.Vector2();
        this.renderer.getSize(originalSize);
        
        this.renderer.setSize(originalSize.x * 2, originalSize.y * 2, false);
        this.renderer.render(this.scene, this.camera);

        const dataURL = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `BIM_Screenshot_${new Date().getTime()}.png`;
        link.href = dataURL;
        link.click();

        this.renderer.setSize(originalSize.x, originalSize.y, true);
        this.pivotSphere.visible = helperVisible;
        this.needsUpdate = true;
    }
}

new BIMApp();