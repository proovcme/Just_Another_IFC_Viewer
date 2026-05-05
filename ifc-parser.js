/**
 * Модуль парсинга IFC-данных и управления видимостью элементов
 * 
 * Основные функции:
 * 1. Парсинг логических систем (IfcDistributionSystem) с рекурсивным обходом связей
 * 2. Группировка физических элементов (IfcProduct) по классам IFC с подсчетом
 * 3. Изоляция элементов на сцене через оптимизированный Subset API
 * 
 * @module IfcDataParser
 */

class IfcDataParser {
    constructor(ifcApi, ifcManager) {
        this.ifcApi = ifcApi;
        this.ifcManager = ifcManager;
        // Кэш для хранения созданных подмножеств геометрии
        this.currentSubset = null;
        // Кэш систем для избежания повторного парсинга
        this.systemsCache = null;
        // Кэш категорий для избежания повторного парсинга
        this.categoriesCache = null;
        
        // Физические типы элементов которые имеют геометрию и должны отображаться
        // Исключаем IfcDistributionPort так как это абстрактные точки подключения
        this.physicalElementTypes = [
            'IfcDuctSegment',
            'IfcDuctFitting',
            'IfcFlowFitting',
            'IfcFlowTerminal',
            'IfcFlowController',
            'IfcFlowMovingDevice',
            'IfcFlowStorage',
            'IfcFlowTreatment',
            'IfcPipeSegment',
            'IfcPipeFitting',
            'IfcValve',
            'IfcDamper',
            'IfcAirTerminal',
            'IfcDiffuser',
            'IfcGrille',
            'IfcRegister',
            'IfcFan',
            'IfcPump',
            'IfcCoil',
            'IfcFilter',
            'IfcHumidifier',
            'IfcEvaporativeCooler',
            'IfcElectricMotor',
            'IfcCableCarrierSegment',
            'IfcCableSegment',
            'IfcJunctionBox'
        ];
    }

    /**
     * Парсит IFC-файл и извлекает логические системы (IfcDistributionSystem и др.)
     * 
     * УЛУЧШЕННАЯ ЛОГИКА ОБХОДА ГРАФА СВЯЗЕЙ IFC:
     * ===========================================
     * В IFC логические системы не имеют собственной геометрии. Они объединяют
     * физические элементы через сложные цепочки отношений:
     * 
     * Прямая связь (редко):
     * IfcDistributionSystem <-- IfcRelAssignsToGroup --> [IfcDuctSegment, IfcFlowFitting]
     * 
     * Косвенная связь (чаще всего):
     * IfcDistributionSystem <-- IfcRelAssignsToGroup --> [IfcDistributionPort]
     *                                                    |
     *                                           IfcRelConnectsPorts
     *                                                    |
     *                                                    v
     *                                          [IfcFlowSegment, IfcFlowFitting]
     * 
     * АЛЬГОРИТМ:
     * 1. Находим все элементы в системе через IfcRelAssignsToGroup
     * 2. Если элемент это порт (IfcDistributionPort), ищем связанные с ним сегменты/фитинги
     * 3. Рекурсивно обходим связи пока не найдем все физические элементы
     * 4. Исключаем порты из финального результата (они не имеют полезной геометрии)
     * 5. Возвращаем только Express ID физической геометрии
     * 
     * @returns {Object} Объект где ключ - имя системы, значение - массив Express ID ФИЗИЧЕСКИХ элементов
     * 
     * Пример возврата:
     * {
     *   "Система вентиляции": [1234, 5678, 9012],  // Только IfcDuctSegment, IfcFlowFitting и т.д.
     *   "Система отопления": [3456, 7890]
     * }
     */
    parseIfcSystems(forceRefresh = false) {
        // Возвращаем кэш если есть и не требуется обновление
        if (this.systemsCache && !forceRefresh) {
            return this.systemsCache;
        }

        const systemsMap = {};
        
        // Типы систем которые могут содержать логические группы
        const systemTypes = [
            this.ifcApi.IfcDistributionSystem,
            this.ifcApi.IfcSystem,
            this.ifcApi.IfcZone
        ];

        // Проходим по каждому типу системы
        for (const type of systemTypes) {
            const systems = this.ifcApi.GetAllItemsOfType(0, type, true);
            
            for (let i = 0; i < systems.size(); i++) {
                const systemId = systems.get(i);
                const systemName = this.getEntityName(systemId);
                
                // Находим все элементы связанные с этой системой
                const directlyRelatedElements = this.findRelatedElementsInGroup(systemId);
                
                // РЕКУРСИВНЫЙ ОБХОД: превращаем порты в физические элементы
                const physicalElementIds = this.resolvePhysicalElements(directlyRelatedElements);
                
                // Добавляем в результат только если есть физические элементы
                if (physicalElementIds.length > 0) {
                    if (systemsMap[systemName]) {
                        // Объединяем с существующими, избегая дубликатов
                        const existing = new Set(systemsMap[systemName]);
                        physicalElementIds.forEach(id => existing.add(id));
                        systemsMap[systemName] = Array.from(existing);
                    } else {
                        systemsMap[systemName] = physicalElementIds;
                    }
                }
            }
        }
        
        this.systemsCache = systemsMap;
        return systemsMap;
    }

    /**
     * Преобразует список элементов (включая порты) в список только физических элементов
     * 
     * КЛЮЧЕВАЯ ЛОГИКА:
     * ================
     * 1. Разделяем элементы на порты и физические элементы
     * 2. Для каждого порта ищем связанные сегменты/фитинги через IfcRelConnectsPorts
     * 3. Рекурсивно продолжаем обход пока не соберем всю трассу
     * 4. Используем Set visitedIds для защиты от циклических ссылок
     * 
     * @param {number[]} elementIds - Массив Express ID из IfcRelAssignsToGroup
     * @returns {number[]} Массив Express ID только физических элементов
     */
    resolvePhysicalElements(elementIds) {
        const physicalIds = new Set();
        const visitedIds = new Set(); // Защита от циклов
        const portIds = [];
        
        // Шаг 1: Разделяем на порты и физические элементы
        for (const id of elementIds) {
            if (visitedIds.has(id)) continue;
            visitedIds.add(id);
            
            try {
                const entity = this.ifcApi.GetLine(0, id, false);
                const typeName = entity.constructor.name;
                
                if (typeName === 'IfcDistributionPort') {
                    // Порт - нужно найти связанные элементы
                    portIds.push(id);
                } else if (this.isPhysicalElementType(typeName)) {
                    // Физический элемент с геометрией - добавляем в результат
                    physicalIds.add(id);
                }
                // Остальные типы игнорируем
            } catch (error) {
                console.warn(`⚠️ Ошибка определения типа элемента ${id}:`, error.message);
            }
        }
        
        // Шаг 2: Для каждого порта находим связанные физические элементы
        for (const portId of portIds) {
            this.findConnectedPhysicalElements(portId, physicalIds, visitedIds);
        }
        
        return Array.from(physicalIds);
    }

    /**
     * Рекурсивно находит физические элементы подключенные к порту
     * 
     * ЛОГИКА ОБХОДА СВЯЗЕЙ ПОРТОВ:
     * ============================
     * IfcRelConnectsPorts связывает два порта:
     * - RelatingPort: первый порт
     * - RelatedPort: второй порт
     * 
     * Каждый порт имеет свойство ConnectedTo которое указывает на элемент:
     * - IfcFlowSegment (сегмент трубы/воздуховода)
     * - IfcFlowFitting (фитинг, тройник, колено)
     * - IfcFlowTerminal (конечное устройство: диффузор, решетка)
     * 
     * Через цепочку портов можно пройти всю трассу системы.
     * 
     * @param {number} portId - Express ID порта
     * @param {Set} physicalIds - Set для накопления найденных физических ID
     * @param {Set} visitedIds - Set посещенных ID для защиты от циклов
     */
    findConnectedPhysicalElements(portId, physicalIds, visitedIds) {
        // Получаем все отношения IfcRelConnectsPorts в модели
        const relConnects = this.ifcApi.GetAllItemsOfType(
            0,
            this.ifcApi.IfcRelConnectsPorts,
            true
        );
        
        for (let i = 0; i < relConnects.size(); i++) {
            const relId = relConnects.get(i);
            
            try {
                const relData = this.ifcApi.GetLine(0, relId, false);
                
                // Проверяем связан ли этот порт с данным отношением
                let connectedPortId = null;
                
                if (relData.RelatingPort && relData.RelatingPort.value === portId) {
                    connectedPortId = relData.RelatedPort ? relData.RelatedPort.value : null;
                } else if (relData.RelatedPort && relData.RelatedPort.value === portId) {
                    connectedPortId = relData.RelatingPort ? relData.RelatingPort.value : null;
                }
                
                if (!connectedPortId) continue;
                
                // Нашли связанный порт! Теперь ищем физические элементы подключенные к обоим портам
                this.extractPhysicalElementsFromPort(portId, physicalIds, visitedIds);
                this.extractPhysicalElementsFromPort(connectedPortId, physicalIds, visitedIds);
                
                // Рекурсивно обрабатываем связанный порт если еще не посещали
                if (!visitedIds.has(connectedPortId)) {
                    visitedIds.add(connectedPortId);
                    
                    // Проверяем тип связанного порта
                    try {
                        const connectedEntity = this.ifcApi.GetLine(0, connectedPortId, false);
                        if (connectedEntity.constructor.name === 'IfcDistributionPort') {
                            // Это тоже порт - продолжаем рекурсивный обход
                            this.findConnectedPhysicalElements(connectedPortId, physicalIds, visitedIds);
                        }
                    } catch (e) {
                        // Игнорируем ошибки
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Ошибка обработки связи портов ${relId}:`, error.message);
            }
        }
    }

    /**
     * Извлекает физические элементы из порта через свойство ConnectedTo
     * 
     * @param {number} portId - Express ID порта
     * @param {Set} physicalIds - Set для накопления найденных физических ID
     * @param {Set} visitedIds - Set посещенных ID
     */
    extractPhysicalElementsFromPort(portId, physicalIds, visitedIds) {
        try {
            const portEntity = this.ifcApi.GetLine(0, portId, false);
            
            // Проверяем ConnectedTo - ссылка на физический элемент
            if (portEntity.ConnectedTo && portEntity.ConnectedTo.value) {
                const connectedId = portEntity.ConnectedTo.value;
                
                if (!visitedIds.has(connectedId)) {
                    visitedIds.add(connectedId);
                    
                    try {
                        const connectedEntity = this.ifcApi.GetLine(0, connectedId, false);
                        const typeName = connectedEntity.constructor.name;
                        
                        if (this.isPhysicalElementType(typeName)) {
                            physicalIds.add(connectedId);
                        }
                    } catch (e) {
                        // Игнорируем
                    }
                }
            }
            
            // Также проверяем ConnectedFrom (обратная связь)
            if (portEntity.ConnectedFrom) {
                const fromRefs = portEntity.ConnectedFrom;
                
                // Может быть массивом или одиночным объектом
                const fromIds = [];
                if (fromRefs && typeof fromRefs.map === 'function') {
                    fromRefs.map(item => { if (item && item.value) fromIds.push(item.value); });
                } else if (Array.isArray(fromRefs)) {
                    fromRefs.forEach(item => { if (item && item.value) fromIds.push(item.value); });
                } else if (fromRefs && fromRefs.value) {
                    fromIds.push(fromRefs.value);
                }
                
                for (const connectedId of fromIds) {
                    if (!visitedIds.has(connectedId)) {
                        visitedIds.add(connectedId);
                        
                        try {
                            const connectedEntity = this.ifcApi.GetLine(0, connectedId, false);
                            const typeName = connectedEntity.constructor.name;
                            
                            if (this.isPhysicalElementType(typeName)) {
                                physicalIds.add(connectedId);
                            }
                        } catch (e) {
                            // Игнорируем
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`⚠️ Ошибка извлечения элементов из порта ${portId}:`, error.message);
        }
    }

    /**
     * Проверяет является ли тип элемента физическим (имеющим геометрию)
     * 
     * @param {string} typeName - Имя типа IFC сущности
     * @returns {boolean} true если это физический элемент с геометрией
     */
    isPhysicalElementType(typeName) {
        return this.physicalElementTypes.includes(typeName);
    }

    /**
     * Находит все элементы, привязанные к группе через IfcRelAssignsToGroup
     * 
     * ДЕТАЛЬНЫЙ РАЗБОР ЛОГИКИ:
     * ========================
     * IfcRelAssignsToGroup - это отношение которое связывает группу объектов с другими объектами.
     * 
     * Структура сущности IfcRelAssignsToGroup:
     * - GlobalId: уникальный идентификатор отношения
     * - OwnerHistory: история владения
     * - Name: имя отношения (опционально)
     * - Description: описание (опционально)
     * - RelatedObjects: ARRAY [1:?] OF IfcObjectReferenceSelect - объекты которые группируются
     * - RelatedObjectsType: тип объектов (опционально)
     * - RelatingGroup: IfcGroup - группа к которой относятся объекты
     * 
     * Проблема производительности:
     * - В большом IFC файле могут быть тысячи IfcRelAssignsToGroup
     * - GetLine вызывает переход через WASM границу (дорогая операция)
     * - Нужно минимизировать количество вызовов GetLine
     * 
     * @param {number} groupId - Express ID группы/системы
     * @returns {number[]} Массив Express ID связанных элементов
     */
    findRelatedElementsInGroup(groupId) {
        const elements = [];
        
        // Получаем все отношения IfcRelAssignsToGroup в модели
        // Это самая тяжелая операция - получает ВСЕ отношения группировки
        const relGroups = this.ifcApi.GetAllItemsOfType(
            0, 
            this.ifcApi.IfcRelAssignsToGroup, 
            true
        );
        
        // Оптимизация: кэшируем размер чтобы не вызывать .size() каждый раз
        const relCount = relGroups.size();
        
        for (let i = 0; i < relCount; i++) {
            const relId = relGroups.get(i);
            
            try {
                // Получаем полную информацию об отношении
                // false означает "не получать вложенные объекты рекурсивно"
                const relatingGroupRef = this.ifcApi.GetLine(0, relId, false);
                
                // Проверяем существует ли RelatingGroup
                if (!relatingGroupRef.RelatingGroup) {
                    continue;
                }
                
                const relatingGroupId = relatingGroupRef.RelatingGroup.value;
                
                // Сравниваем с нашей целевой группой
                if (relatingGroupId === groupId) {
                    // Нашли нужное отношение! Извлекаем RelatedObjects
                    const relatedObjects = relatingGroupRef.RelatedObjects;
                    
                    // ОБРАБОТКА РАЗНЫХ ФОРМАТОВ RelatedObjects:
                    // В зависимости от версии IFC и парсера, RelatedObjects может быть:
                    // 1. Объектом с методом .map() (вектор C++)
                    // 2. Обычным JavaScript массивом
                    // 3. Единичным объектом (редко)
                    
                    if (relatedObjects && typeof relatedObjects.map === 'function') {
                        // Вариант 1: вектор C++ с методом map
                        relatedObjects.map(item => {
                            if (item && item.value !== undefined) {
                                elements.push(item.value);
                            }
                        });
                    } else if (Array.isArray(relatedObjects)) {
                        // Вариант 2: обычный JS массив
                        relatedObjects.forEach(item => {
                            if (item && item.value !== undefined) {
                                elements.push(item.value);
                            }
                        });
                    } else if (relatedObjects && relatedObjects.value !== undefined) {
                        // Вариант 3: единичный объект
                        elements.push(relatedObjects.value);
                    }
                }
            } catch (error) {
                // Игнорируем ошибки получения отдельных отношений
                // Это важно так как некоторые сущности могут быть повреждены
                console.warn(`⚠️ Ошибка обработки отношения ${relId}:`, error.message);
            }
        }
        
        // Удаляем дубликаты ID (один элемент может входить в несколько отношений)
        return [...new Set(elements)];
    }

    /**
     * Парсит физические элементы (IfcProduct) и группирует их по классам IFC
     * 
     * ЛОГИКА ГРУППИРОВКИ:
     * ===================
     * IfcProduct - это базовый класс для всех физических объектов в IFC:
     * - IfcWall (стены)
     * - IfcDuctSegment (воздуховоды)
     * - IfcFlowFitting (фитинги)
     * - IfcSlab (перекрытия)
     * - и т.д.
     * 
     * Важно: IfcProduct включает как объекты с геометрией так и без
     * Для фильтрации только геометрических объектов можно проверить наличие geometry
     * 
     * Производительность:
     * - GetAllItemsOfType для IfcProduct может вернуть десятки тысяч объектов
     * - GetLine для каждого объекта - дорогая операция
     * - Используем кэширование имени типа через constructor.name
     * 
     * @returns {Array} Массив объектов с информацией о категориях
     * 
     * Пример возврата:
     * [
     *   { name: 'IfcDuctSegment', count: 150, ids: [123, 456, ...], items: [...] },
     *   { name: 'IfcFlowFitting', count: 75, ids: [789, 012, ...], items: [...] }
     * ]
     */
    parseIfcCategories(forceRefresh = false) {
        // Возвращаем кэш если есть и не требуется обновление
        if (this.categoriesCache && !forceRefresh) {
            return this.categoriesCache;
        }

        const categoriesMap = new Map();
        
        // Получаем все продукты (физические элементы)
        // true означает включать все наследующие типы
        const products = this.ifcApi.GetAllItemsOfType(
            0, 
            this.ifcApi.IfcProduct, 
            true
        );
        
        const productCount = products.size();
        
        for (let i = 0; i < productCount; i++) {
            const productId = products.get(i);
            
            try {
                // Получаем полную информацию о сущности
                const entityType = this.ifcApi.GetLine(0, productId, false);
                
                // Используем constructor.name для определения типа
                // Это быстрее чем проверка каждого возможного типа
                const typeName = entityType.constructor.name;
                
                // Пропускаем абстрактные типы без геометрии
                if (typeName === 'IfcProduct' || typeName === 'IfcObject') {
                    continue;
                }
                
                // Получаем имя элемента для идентификации
                const entityName = this.getEntityName(productId);
                
                if (!categoriesMap.has(typeName)) {
                    categoriesMap.set(typeName, {
                        name: typeName,
                        count: 0,
                        ids: [],
                        items: []
                    });
                }
                
                const category = categoriesMap.get(typeName);
                category.count++;
                category.ids.push(productId);
                category.items.push({
                    id: productId,
                    name: entityName
                });
            } catch (error) {
                console.warn(`⚠️ Ошибка обработки продукта ${productId}:`, error.message);
            }
        }
        
        this.categoriesCache = Array.from(categoriesMap.values());
        // Сортируем по количеству элементов (убывание) для удобства
        this.categoriesCache.sort((a, b) => b.count - a.count);
        
        return this.categoriesCache;
    }

    /**
     * Вспомогательный метод для получения имени сущности
     * 
     * Пытается получить Name, затем Tag, затем fallback на ID
     * Обработан для устойчивости к ошибкам парсинга
     * 
     * @param {number} entityId - Express ID сущности
     * @returns {string} Человекочитаемое имя
     */
    getEntityName(entityId) {
        try {
            const entity = this.ifcApi.GetLine(0, entityId, false);
            if (entity.Name && entity.Name.value) {
                return entity.Name.value;
            } else if (entity.Tag && entity.Tag.value) {
                return entity.Tag.value;
            } else if (entity.GlobalId && entity.GlobalId.value) {
                // Fallback на GlobalId если нет имени
                return entity.GlobalId.value.substring(0, 8);
            }
            return `Unnamed_${entityId}`;
        } catch (error) {
            return `ID_${entityId}`;
        }
    }

    /**
     * Изолирует элементы на сцене - скрывает все, кроме указанных
     * 
     * ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ:
     * ===============================
     * При работе с большими IFC моделями (100k+ элементов) naive подход
     * "скрыть каждый меш отдельно" вызывает:
     * - Тысячи вызовов к Three.js
     * - Множественные перерисовки сцены
     * - Проблемы с FPS
     * 
     * РЕШЕНИЕ: Использовать Subset API от web-ifc-three
     * - createSubset создает отдельную геометрию только с нужными элементами
     * - Это одна операция вместо тысяч
     * - Оригинальная сетка скрывается одним флагом visible = false
     * - Удаление подмножества тоже одна операция
     * 
     * Альтернативный подход (если Subset недоступен):
     * - Использовать SpatialTree для быстрого поиска мешей по ID
     * - Применять batch updates к visible свойству
     * 
     * @param {THREE.Scene} scene - Three.js сцена
     * @param {number} modelId - ID модели в IFCLoader
     * @param {number[]} elementIds - Массив Express ID для отображения
     * @param {IFCMesh} ifcMeshes - Основная IFC сетка модели
     */
    isolateElements(scene, modelId, elementIds, ifcMeshes) {
        // Защита от пустого массива
        if (!elementIds || elementIds.length === 0) {
            console.warn('⚠️ isolateElements: пустой массив элементов');
            return;
        }

        // Если уже есть активное подмножество, удаляем его
        if (this.currentSubset) {
            scene.remove(this.currentSubset);
            
            // Освобождаем память
            if (this.currentSubset.geometry) {
                this.currentSubset.geometry.dispose();
            }
            if (this.currentSubset.material) {
                this.currentSubset.material.dispose();
            }
            this.currentSubset = null;
        }
        
        try {
            // Создаем новое подмножество с указанными элементами
            // removePrevious: true автоматически удаляет предыдущее подмножество
            this.currentSubset = this.ifcManager.createSubset({
                modelID: modelId,
                scene: scene,
                ids: elementIds,
                removePrevious: true
            });
            
            // Скрываем оригинальную сетку
            ifcMeshes.visible = false;
            
            console.log(`✓ Изолировано ${elementIds.length} элементов`);
        } catch (error) {
            console.error('❌ Ошибка при изоляции элементов:', error);
            // Fallback: пробуем скрыть элементы через прямой доступ к мемам
            this.isolateElementsFallback(scene, modelId, elementIds, ifcMeshes);
        }
    }

    /**
     * Fallback метод изоляции если Subset API недоступен
     * Использует прямой доступ к геометрии через SpatialTree
     */
    isolateElementsFallback(scene, modelId, elementIds, ifcMeshes) {
        const idsSet = new Set(elementIds);
        
        // Рекурсивно проходим по всем дочерним объектам
        const hideUnwanted = (object) => {
            if (object.userData && object.userData.expressID !== undefined) {
                object.visible = idsSet.has(object.userData.expressID);
            }
            if (object.children) {
                object.children.forEach(hideUnwanted);
            }
        };
        
        hideUnwanted(ifcMeshes);
        ifcMeshes.visible = true; // Корневой объект оставляем видимым
    }

    /**
     * Сбрасывает изоляцию и возвращает всю геометрию
     * 
     * Важно: полностью удаляет подмножество и освобождает память
     * чтобы избежать утечек памяти при длительной работе
     * 
     * @param {THREE.Scene} scene - Three.js сцена
     * @param {IFCMesh} ifcMeshes - Основная IFC сетка модели
     */
    resetVisibility(scene, ifcMeshes) {
        // Удаляем текущее подмножество
        if (this.currentSubset) {
            scene.remove(this.currentSubset);
            
            // Освобождаем память - критично для предотвращения утечек
            if (this.currentSubset.geometry) {
                this.currentSubset.geometry.dispose();
            }
            if (this.currentSubset.material) {
                this.currentSubset.material.dispose();
            }
            this.currentSubset = null;
            
            console.log('✓ Подмножество удалено');
        }
        
        // Показываем оригинальную сетку
        ifcMeshes.visible = true;
        
        // Восстанавливаем видимость всех дочерних объектов
        // (на случай если использовался fallback метод)
        const showAll = (object) => {
            if (object.userData && object.userData.expressID !== undefined) {
                object.visible = true;
            }
            if (object.children) {
                object.children.forEach(showAll);
            }
        };
        
        showAll(ifcMeshes);
        
        console.log('✓ Видимость сброшена');
    }

    /**
     * Очищает все кэши
     * Полезно при загрузке новой модели
     */
    clearCache() {
        this.systemsCache = null;
        this.categoriesCache = null;
        
        if (this.currentSubset) {
            this.currentSubset = null;
        }
    }
}

// Экспортируем класс для использования в других модулях
export { IfcDataParser };
