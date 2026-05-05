class IfcDataParser {
    constructor(ifcApi) {
        this.ifcApi = ifcApi;
    }

    /**
     * Парсит IFC-файл и извлекает логические системы (IfcDistributionSystem и др.)
     * Обходит связи IfcRelAssignsToGroup, где RelatingGroup - это система,
     * и RelatedObjects - это элементы, принадлежащие этой системе
     */
    parseIfcSystems() {
        const systemsMap = {};
        
        // Получаем все системы (IfcDistributionSystem и другие подклассы IfcSystem)
        const systemTypes = [
            this.ifcApi.IfcDistributionSystem,
            this.ifcApi.IfcStructuralAnalysisModel,
            this.ifcApi.IfcSystem,
            this.ifcApi.IfcZone
        ];

        for (const type of systemTypes) {
            const systems = this.ifcApi.GetAllItemsOfType(0, type, true);
            
            for (let i = 0; i < systems.size(); i++) {
                const systemId = systems.get(i);
                
                // Получаем имя системы
                const systemName = this.getEntityName(systemId);
                
                // Ищем связи IfcRelAssignsToGroup, где эта система - RelatingGroup
                const relatedElements = this.findRelatedElementsInGroup(systemId);
                
                if (relatedElements.length > 0) {
                    systemsMap[systemName] = relatedElements;
                }
            }
        }
        
        return systemsMap;
    }

    /**
     * Находит все элементы, привязанные к группе через IfcRelAssignsToGroup
     * Это критически важная логика для понимания структуры IFC-файла
     */
    findRelatedElementsInGroup(groupId) {
        const elements = [];
        
        // Ищем все IfcRelAssignsToGroup
        const relGroups = this.ifcApi.GetAllItemsOfType(
            0, 
            this.ifcApi.IfcRelAssignsToGroup, 
            true
        );
        
        for (let i = 0; i < relGroups.size(); i++) {
            const relId = relGroups.get(i);
            
            // Получаем RelatingGroup (это наша система)
            const relatingGroupRef = this.ifcApi.GetLine(0, relId, false);
            const relatingGroupId = relatingGroupRef.RelatingGroup.value;
            
            if (relatingGroupId === groupId) {
                // Получаем RelatedObjects (элементы системы)
                const relatedObjects = relatingGroupRef.RelatedObjects;
                
                if (relatedObjects && relatedObjects.map) {
                    relatedObjects.map(item => {
                        if (item && item.value !== undefined) {
                            elements.push(item.value);
                        }
                    });
                } else if (relatedObjects && Array.isArray(relatedObjects)) {
                    relatedObjects.forEach(item => {
                        if (item && item.value !== undefined) {
                            elements.push(item.value);
                        }
                    });
                }
            }
        }
        
        return elements;
    }

    /**
     * Парсит физические элементы (IfcProduct) и группирует их по классам
     * Считает количество элементов в каждой категории
     */
    parseIfcCategories() {
        const categoriesMap = new Map();
        
        // Получаем все продукты (физические элементы с геометрией)
        const products = this.ifcApi.GetAllItemsOfType(
            0, 
            this.ifcApi.IfcProduct, 
            true
        );
        
        for (let i = 0; i < products.size(); i++) {
            const productId = products.get(i);
            
            // Получаем тип элемента
            const entityType = this.ifcApi.GetLine(0, productId, false);
            const typeName = entityType.constructor.name;
            
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
        }
        
        return Array.from(categoriesMap.values());
    }

    /**
     * Вспомогательный метод для получения имени сущности
     */
    getEntityName(entityId) {
        try {
            const entity = this.ifcApi.GetLine(0, entityId, false);
            if (entity.Name && entity.Name.value) {
                return entity.Name.value;
            } else if (entity.Tag && entity.Tag.value) {
                return entity.Tag.value;
            }
            return `Unnamed_${entityId}`;
        } catch (error) {
            return `ID_${entityId}`;
        }
    }

    /**
     * Изолирует элементы на сцене - скрывает все, кроме указанных
     * Использует оптимизированный подход через Subset для лучшей производительности
     */
    isolateElements(scene, modelId, elementIds, ifcMeshes) {
        // Если уже есть активное подмножество, удаляем его
        if (this.currentSubset) {
            scene.remove(this.currentSubset);
            this.currentSubset = null;
        }
        
        // Создаем новое подмножество с указанными элементами
        // Это более эффективно, чем скрывать/показывать каждый меш отдельно
        this.currentSubset = ifcMeshes.createSubset({
            scene,
            ids: elementIds,
            removePrevious: true,
            modelID: modelId
        });
        
        // Скрываем оригинальную сетку
        ifcMeshes.visible = false;
    }

    /**
     * Сбрасывает изоляцию и возвращает всю геометрию
     */
    resetVisibility(scene, ifcMeshes) {
        // Удаляем текущее подмножество
        if (this.currentSubset) {
            scene.remove(this.currentSubset);
            this.currentSubset = null;
        }
        
        // Показываем оригинальную сетку
        ifcMeshes.visible = true;
    }
}

// Экспортируем класс для использования в других модулях
export { IfcDataParser };
