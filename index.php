<?php
/**
 * /bim/index.php - BIM AI Viewer v8.0.1
 */
$siteId    = 'main';
$pageTitle = 'BIM AI Viewer v8.0.1 - Federated-BIM';

// Сканируем папку models на наличие IFC файлов
$modelsDir = __DIR__ . '/models';
$ifcFiles = glob($modelsDir . '/*.ifc');
$modelsList = [];
foreach ($ifcFiles as $file) {
    $modelsList[] = basename($file);
}

include __DIR__ . '/../header.php';
?>

<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./style.css?v=<?php echo time(); ?>">
<script>
    window.SERVER_MODELS = <?php echo json_encode($modelsList); ?>;
</script>

<style>
    html, body { height: 100vh !important; overflow: hidden !important; display: flex; flex-direction: column; margin: 0; padding: 0; }
    main.container { max-width: 100% !important; padding: 0 !important; margin: 0 !important; flex: 1; display: flex; flex-direction: column; }
    #container { width: 100%; flex-grow: 1; position: relative; background: #f0ede6; overflow: hidden; }
    .site-footer { display: none; }
</style>

<div id="container">
    <!-- Оверлей каски из v7.8[2] -->
    <div id="hardhat-overlay">
        <div id="hardhat-message">
            👷 Режим прораба<br>
            <span style="font-size: 16px; font-weight: 600; color: #fbbc04;">Управление: WASD или Стрелочки</span><br>
            <span style="font-size: 12px; font-weight: 400; opacity: 0.8;">Выход - повторный клик на каску</span>
        </div>
    </div>

    <div id="status">Инициализация движка...</div>

    <div class="toolbar" style="z-index: 100;">
      <button class="btn btn-primary" id="btn-add-file">📁 ДОБАВИТЬ IFC</button>
      <button class="btn" id="btn-models">🗂️ МОДЕЛИ</button>
      <button class="btn" id="toggle-tree-btn">Дерево</button>
      <button class="btn" id="screenshot-btn">📸 Снимок</button>
      <button class="btn" id="btn-settings">⚙️ НАСТРОЙКИ</button>
      <button class="btn" id="btn-measure">📏 ИЗМЕРИТЬ</button>
      <button class="btn" id="btn-spaces-toggle">📦 ПОМЕЩЕНИЯ</button>
      <button class="btn" id="btn-section">✂️ СЕЧЕНИЕ</button>
      <button class="btn" id="btn-cam">🎥 ОРТО</button>
      <button class="btn" id="btn-xray">🦴 X-RAY</button>
      <button class="btn btn-danger" id="btn-reset-scene">↺ СБРОС</button>
    </div>

    <!-- Диспетчер сборки[2] -->
    <div id="nav-panel" class="panel hidden">
      <div class="panel-header">Диспетчер сборки</div>
      <div id="space-search-wrapper" class="hidden" style="margin-bottom: 15px; position: relative;">
          <input type="text" id="space-search" placeholder="Поиск помещения..." style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; box-sizing: border-box;">
          <div id="spaces-results" class="search-results hidden"></div>
      </div>
      <div id="local-models-list"></div>
    </div>

    <!-- Настройки графики (обязательны для app.js)[3] -->
    <div id="settings-panel" class="panel hidden">
      <div class="panel-header">Настройки Viewer</div>
      <div class="section-control">
          <label>Качество графики</label>
          <div style="display: flex; gap: 5px; margin-top: 5px;">
              <button class="btn btn-mode mode-sport" id="btn-mode-sport" style="flex: 1; padding: 4px; font-size: 10px;">СПОРТ</button>
              <button class="btn btn-mode" id="btn-mode-balance" style="flex: 1; padding: 4px; font-size: 10px; background: #174ea6; color: #fff;">БАЛАНС</button>
              <button class="btn btn-mode" id="btn-mode-beauty" style="flex: 1; padding: 4px; font-size: 10px; background: #8e24aa; color: #fff;">КРАСОТА</button>
          </div>
      </div>
      <div class="section-control" style="margin-top: 15px;">
          <label>Цвет фона</label>
          <input type="color" id="input-bg-color" value="#f0ede6" style="width: 100%; height: 30px; border: none; cursor: pointer; margin-top: 5px;">
      </div>
      <div class="section-control" style="margin-top: 15px;">
          <label>Резкость вращения</label>
          <input type="range" id="range-sens" min="0.1" max="2.0" step="0.1" value="1.0" style="margin-top: 5px; width: 100%;">
      </div>
      <div class="section-control" style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
          <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="check-gpu" checked> Максимальная мощь GPU
          </label>
      </div>
    </div>

    <div id="measure-panel" class="panel hidden">
      <div class="panel-header">Рулетка <span id="btn-clear-measure" style="float: right; cursor: pointer; color: #d93025;">🗑️</span></div>
      <div id="measure-results"></div>
    </div>

    <div id="section-panel" class="panel hidden">
      <div class="panel-header">Управление сечениями</div>
      <div class="section-control">
          <label><input type="checkbox" id="check-sec-y"> Горизонталь (Y)</label>
          <input type="range" id="range-sec-y" class="hidden" step="0.1">
      </div>
      <div class="section-control" style="margin-top: 15px;">
          <label><input type="checkbox" id="check-sec-x"> Вертикаль (X)</label>
          <input type="range" id="range-sec-x" class="hidden" step="0.1">
      </div>
    </div>

    <!-- Красивое окно свойств из v7.8[2] -->
    <div id="props-panel" class="panel hidden">
      <span class="close-btn" id="btn-close-props">×</span>
      <div class="panel-header">Свойства объекта</div>
      <div style="display: flex; gap: 5px; margin-bottom: 10px;">
          <button class="btn btn-danger" style="flex: 1;" id="btn-hide-element">🚫 СКРЫТЬ</button>
          <button class="btn btn-primary" style="flex: 1;" id="btn-reset-visibility">👁️ ВЕРНУТЬ ВСЕ</button>
      </div>
      <div id="props-content"></div>
    </div>

    <!-- Дерево Проекта -->
    <div id="tree-panel" class="hidden">
      <div class="panel-header">Структура проекта <button id="close-tree">×</button></div>
      <div class="tree-search-container">
          <input type="text" id="tree-search" placeholder="Поиск по дереву (имя или ID)...">
      </div>
      <div id="tree-indexer-block" style="padding: 0 10px 10px 10px;">
          <button id="btn-index-data" class="btn" style="width: 100%; cursor: pointer;">⚡ Индексировать BIM-данные</button>
          <div id="index-progress" style="font-size: 11px; margin-top: 5px; text-align: center; display: none;"></div>
      </div>
      <div id="systems-container" style="padding: 0 10px 10px 10px; display: none;">
          <div style="font-size: 11px; color: var(--ink3); margin-bottom: 8px;">НАЙДЕННЫЕ СИСТЕМЫ:</div>
          <div id="systems-list" style="display: flex; flex-wrap: wrap; gap: 5px;"></div>
      </div>
      <div id="tree-content"></div>
    </div>

    <div id="nav-group">
      <button id="btn-secret-mode" style="background: none; border: none; font-size: 22px; opacity: 0.3; cursor: pointer; outline: none; margin-bottom: 5px;">👷</button>
      <button class="btn btn-primary btn-round" id="home-btn">🏠</button>
      <div id="viewcube"></div>
    </div>

    <button id="help-btn-float" style="position: absolute; bottom: 20px; right: 20px; border-radius: 50%; width: 40px; height: 40px; border: none; background: var(--accent); color: #fff; cursor: pointer; z-index: 100;">?</button>
    <div id="help-modal" class="panel hidden" style="top: auto; bottom: 70px; right: 20px; width: 220px;">
      <div class="panel-header">Справка <span class="close-btn" id="btn-close-help">×</span></div>
      <div class="help-content" style="text-align: left; font-size: 14px; line-height: 1.6;">
          <h3 style="margin-top: 0;">Управление камерой</h3>
          <ul style="list-style: none; padding-left: 0;">
              <li>🖱️ <b>ЛКМ</b> — Вращение (Орбита)</li>
              <li>🖱️ <b>ПКМ</b> — Панорамирование</li>
              <li>⚙️ <b>Колесико</b> — Зум</li>
              <li>⌨️ <b>E / Q</b> — Вертикальный взлет и спуск (режим дрона)</li>
          </ul>
      
          <h3>Работа с моделью</h3>
          <ul style="list-style: none; padding-left: 0;">
              <li>🎯 <b>Двойной клик</b> — Полет к элементу и открытие свойств</li>
              <li>📋 <b>Клик по свойству</b> — Быстрое копирование в буфер</li>
              <li>👁️ <b>Иконка глаза в дереве</b> — Скрытие/показ элементов и веток</li>
              <li>⚡ <b>Молния (Дерево)</b> — Быстрая индексация BIM-параметров для поиска</li>
              <li>⛶️ <b>Клик по тегу системы</b> — Изоляция инженерной системы на 3D виде</li>
          </ul>
      </div>
    </div>
    <div id="app-version">v8.0.1</div>
    <div id="debug-log" class="hidden"></div>
</div>

<input type="file" id="file-input" class="hidden" accept=".ifc" multiple style="display: none;">

<script type="importmap">
  {
    "imports": {
      "three": "./node_modules/three/build/three.module.js",
      "three/addons/": "./node_modules/three/examples/jsm/",
      "three/examples/jsm/utils/BufferGeometryUtils": "./node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
      "web-ifc-three": "./node_modules/web-ifc-three/IFCLoader.js",
      "web-ifc": "./node_modules/web-ifc/web-ifc-api.js"
    }
  }
</script>
    <script type="module" src="./app.js?v=<?php echo time(); ?>"></script>
    <script>
        window.isMobileMode = window.innerWidth <= 1000;
        if (window.isMobileMode) document.body.classList.add('is-mobile');
        
        window.addEventListener('resize', () => {
            window.isMobileMode = window.innerWidth <= 1000;
            if (window.isMobileMode) {
                document.body.classList.add('is-mobile');
            } else {
                document.body.classList.remove('is-mobile');
            }
        });
    </script>

<?php include __DIR__ . '/../footer.php'; ?>