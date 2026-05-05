/**
 * Модуль парсинга IFC-данных и управления видимостью элементов
 * 
 * Основные функции:
 * 1. Парсинг логических систем (IfcDistributionSystem) через связи IfcRelAssignsToGroup
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
    }

    /**
     * Парсит IFC-файл и извлекает логические системы (IfcDistributionSystem и др.)
     * 
     * ЛОГИКА ОБХОДА ГРАФА СВЯЗЕЙ IFC:
     * ================================
     * В IFC логические системы (например, система вентиляции, система водоснабжения)
     * не имеют собственной геометрии. Они представляют собой абстрактные группы,
     * которые объединяют физические элементы через отношения (relationships).
     * 
     * Структура связи выглядит так:
     * IfcDistributionSystem (система) <-- RelatingGroup -- IfcRelAssignsToGroup -- RelatedObjects --> [IfcDuctSegment, IfcFlowFitting, ...]
     * 
     * Ключевой момент: нужно найти все экземпляры IfcRelAssignsToGroup, где:
     * - RelatingGroup указывает на нашу систему
     * - RelatedObjects содержит массив ссылок на физические элементы
     * 
     * Это "узкое место" потому что:
     * 1. Нужно перебрать все отношения в файле (может быть тысячи)
     * 2. Для каждого отношения получить данные и проверить RelatingGroup
     * 3. RelatedObjects может быть представлен по-разному (единый объект или массив)
     * 
     * @returns {Object} Объект где ключ - имя системы, значение - массив Express ID элементов
     * 
     * Пример возврата:
     * {
     *   "Система вентиляции": [1234, 5678, 9012],
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
        // IfcDistributionSystem - основной тип для инженерных систем
        // IfcSystem - базовый абстрактный тип
        // IfcZone - зональная система (например, температурная зона)
        const systemTypes = [
            this.ifcApi.IfcDistributionSystem,
            this.ifcApi.IfcSystem,
            this.ifcApi.IfcZone
        ];

        // Проходим по каждому типу системы
        for (const type of systemTypes) {
            // GetAllItemsOfType возвращает все ID сущностей указанного типа
            // Параметр true означает "includeInherited" - включать наследников типа
            const systems = this.ifcApi.GetAllItemsOfType(0, type, true);
            
            // systems - это вектор C++ доступный через WASM, используем .size() и .get(i)
            for (let i = 0; i < systems.size(); i++) {
                const systemId = systems.get(i);
                
                // Получаем человекочитаемое имя системы
                const systemName = this.getEntityName(systemId);
                
                // КРИТИЧЕСКИ ВАЖНАЯ ЛОГИКА:
                // Находим все элементы связанные с этой системой через IfcRelAssignsToGroup
                const relatedElements = this.findRelatedElementsInGroup(systemId);
                
                // Добавляем в результат только если есть связанные элементы
                if (relatedElements.length > 0) {
                    // Если система с таким именем уже есть, объединяем элементы
                    if (systemsMap[systemName]) {
                        systemsMap[systemName] = [...systemsMap[systemName], ...relatedElements];
                    } else {
                        systemsMap[systemName] = relatedElements;
                    }
                }
            }
        }
        
        this.systemsCache = systemsMap;
        return systemsMap;
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
