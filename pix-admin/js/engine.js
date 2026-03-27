// PIX Admin - Soil/Leaf Interpretation & Fertilization Engine
// Complete agronomic calculation engine for precision agriculture

class InterpretationEngine {

  // ==================== DRIS/IBRA NORM LOADING ====================

  // Load DRIS/IBRA norms from external JSON file.
  // Call once at app startup: await InterpretationEngine.loadNorms()
  // Optional basePath defaults to 'data/ibra-norms.json' (relative to page).
  // Returns the loaded norms object, or throws on fetch/parse failure.
  static async loadNorms(basePath) {
    // Return immediately if already loaded
    if (InterpretationEngine._drisNorms) {
      return InterpretationEngine._drisNorms;
    }
    // Deduplicate concurrent calls — return the same in-flight promise
    if (InterpretationEngine._drisCachePromise) {
      return InterpretationEngine._drisCachePromise;
    }

    const url = basePath || 'data/ibra-norms.json';
    InterpretationEngine._drisCachePromise = fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ibra-norms.json: ${res.status} ${res.statusText}`);
        return res.json();
      })
      .then(json => {
        InterpretationEngine._drisNorms     = json.norms;
        InterpretationEngine._drisNutrients = json.nutrients;
        return json.norms;
      })
      .catch(err => {
        // Clear the promise so a retry is possible
        InterpretationEngine._drisCachePromise = null;
        throw err;
      });

    return InterpretationEngine._drisCachePromise;
  }

  // Internal helper: return norms for a crop from the loaded cache.
  // Falls back to the legacy global DRIS_NORMS if it exists (backwards compat).
  static _getNormsForCrop(cropId) {
    if (InterpretationEngine._drisNorms) {
      return InterpretationEngine._drisNorms[cropId] || null;
    }
    // Legacy fallback: global variable from crops-data.js (if still present)
    if (typeof DRIS_NORMS !== 'undefined') {
      return DRIS_NORMS[cropId] || null;
    }
    return null;
  }

  // Internal helper: return the nutrient list from cache or legacy global.
  static _getDrisNutrients() {
    if (InterpretationEngine._drisNutrients) {
      return InterpretationEngine._drisNutrients;
    }
    if (typeof DRIS_NUTRIENTS !== 'undefined') {
      return DRIS_NUTRIENTS;
    }
    return ['N','P','K','Ca','Mg','S','B','Cu','Fe','Mn','Zn'];
  }

  // ==================== UNIT CONVERSION ====================

  // Convert a value from user-selected units to internal units (mmolc/dm³, g/dm³, %)
  static convertToInternal(param, value, unitSystem) {
    if (!unitSystem) return value;
    const group = PARAM_UNIT_GROUP[param];
    if (!group) return value;

    const selectedUnit = unitSystem[group];
    if (!selectedUnit) return value;

    const unitDef = UNIT_SYSTEMS[group]?.[selectedUnit];
    if (!unitDef || unitDef.factor === 1) return value;

    return value * unitDef.factor;
  }

  // Convert from internal units back to display units
  static convertFromInternal(param, value, unitSystem) {
    if (!unitSystem) return value;
    const group = PARAM_UNIT_GROUP[param];
    if (!group) return value;

    const selectedUnit = unitSystem[group];
    if (!selectedUnit) return value;

    const unitDef = UNIT_SYSTEMS[group]?.[selectedUnit];
    if (!unitDef || unitDef.factor === 1) return value;

    return value / unitDef.factor;
  }

  // Get display unit label for a parameter given current unit system
  static getDisplayUnit(param, unitSystem) {
    const group = PARAM_UNIT_GROUP[param];
    if (!group) {
      if (param === 'pH_H2O') return '';
      if (param === 'V') return '%';
      return NUTRIENT_INFO[param]?.unit || '';
    }
    const selectedUnit = unitSystem?.[group];
    if (!selectedUnit) return NUTRIENT_INFO[param]?.unit || '';
    return UNIT_SYSTEMS[group]?.[selectedUnit]?.label || NUTRIENT_INFO[param]?.unit || '';
  }

  // Normalize full labData from user units to internal units
  static normalizeLabData(labData, unitSystem) {
    if (!unitSystem) return { ...labData };
    const normalized = {};
    for (const [key, val] of Object.entries(labData)) {
      if (val === undefined || val === null || val === '') continue;
      normalized[key] = this.convertToInternal(key, parseFloat(val), unitSystem);
    }
    return normalized;
  }

  // ==================== METHOD-AWARE CLASSIFICATION ====================

  // Get P ranges based on extraction method and texture/crop
  static getPRanges(cropId, pMethod, textureGroup) {
    const method = P_METHODS[pMethod];
    if (!method) {
      const crop = CROPS_DB[cropId];
      return crop?.soil?.P || null;
    }

    if (pMethod === 'resina') {
      const cropType = CROP_P_TYPE[cropId] || 'anuales';
      return method.byCropType[cropType] || method.byCropType.anuales;
    }

    // Mehlich 1 or 3: use texture group
    const group = textureGroup || 2;
    return method.byTexture[group] || method.byTexture[2];
  }

  // Get method-specific ranges for any nutrient (K, Ca, Mg, S, B, etc.)
  // Returns null if no method-specific range → fallback to crop defaults
  static getMethodRanges(nutrient, pMethod, cropId) {
    if (!pMethod || !METHOD_RANGES?.[pMethod]) return null;
    const methodDef = METHOD_RANGES[pMethod][nutrient];
    if (!methodDef) return null;

    // Check for crop-type-specific ranges (resina: anuales/hortalizas/perennes)
    if (pMethod === 'resina') {
      const cropType = CROP_P_TYPE[cropId] || 'anuales';
      if (methodDef[cropType]) return methodDef[cropType];
    }

    // Fallback to 'default' key
    return methodDef.default || null;
  }

  // Classify P with method awareness
  static classifyP(pValue, cropId, pMethod, textureGroup) {
    const ranges = this.getPRanges(cropId, pMethod, textureGroup);
    if (!ranges) return { class: 'N/D', label: 'Sin datos', color: '#6b7280' };

    for (const [cls, [min, max]] of Object.entries(ranges)) {
      if (pValue >= min && pValue < max) {
        return {
          class: cls,
          label: CLASS_LABELS[cls] || cls,
          color: CLASS_COLORS[cls] || '#6b7280',
          min, max,
          method: P_METHODS[pMethod]?.name || pMethod
        };
      }
    }
    return { class: 'N/D', label: 'Fuera de rango', color: '#6b7280' };
  }

  // ==================== SOIL ANALYSIS INTERPRETATION ====================

  // Classify a single nutrient value against crop-specific ranges
  // options: { pMethod, phMethod, textureGroup }
  static classifySoil(nutrient, value, cropId, options) {
    // pH uses dedicated pH method ranges
    if (nutrient === 'pH_H2O' && options?.phMethod && typeof PH_RANGES !== 'undefined') {
      const phMethod = options.phMethod || 'agua';
      const cropType = CROP_P_TYPE[cropId] || 'anuales';
      const phRanges = PH_RANGES[phMethod]?.[cropType] || PH_RANGES[phMethod]?.anuales;
      if (phRanges) {
        for (const [cls, [min, max]] of Object.entries(phRanges)) {
          if (value >= min && value < max) {
            return {
              class: cls,
              label: CLASS_LABELS[cls] || cls,
              color: CLASS_COLORS[cls] || '#6b7280',
              min, max,
              method: phMethod === 'cacl2' ? 'CaCl₂' : 'H₂O'
            };
          }
        }
        return { class: 'N/D', label: 'Fuera de rango', color: '#6b7280' };
      }
    }

    // P uses dedicated method-aware classification (texture-dependent)
    if (nutrient === 'P' && options?.pMethod) {
      return this.classifyP(value, cropId, options.pMethod, options.textureGroup);
    }

    // Check method-specific ranges for this nutrient (K, Ca, Mg, S, B, etc.)
    if (options?.pMethod) {
      const methodRanges = this.getMethodRanges(nutrient, options.pMethod, cropId);
      if (methodRanges) {
        for (const [cls, [min, max]] of Object.entries(methodRanges)) {
          if (value >= min && value < max) {
            return {
              class: cls,
              label: CLASS_LABELS[cls] || cls,
              color: CLASS_COLORS[cls] || '#6b7280',
              min, max,
              method: P_METHODS[options.pMethod]?.name || options.pMethod
            };
          }
        }
        return { class: 'N/D', label: 'Fuera de rango', color: '#6b7280' };
      }
    }

    // Fallback: crop-default ranges
    const crop = CROPS_DB[cropId];
    if (!crop || !crop.soil[nutrient]) return { class: 'N/D', label: 'Sin datos', color: '#6b7280' };

    const ranges = crop.soil[nutrient];
    for (const [cls, [min, max]] of Object.entries(ranges)) {
      if (value >= min && value < max) {
        return {
          class: cls,
          label: CLASS_LABELS[cls] || cls,
          color: CLASS_COLORS[cls] || '#6b7280',
          min, max
        };
      }
    }
    return { class: 'N/D', label: 'Fuera de rango', color: '#6b7280' };
  }

  // Full soil analysis interpretation
  // options: { pMethod: 'mehlich1'|'mehlich3'|'resina', unitSystem: {...} }
  static interpretSoil(labData, cropId, options) {
    const crop = CROPS_DB[cropId];
    if (!crop) return { error: 'Cultivo no encontrado' };

    // Normalize units to internal if unit system is provided
    const data = options?.unitSystem ? this.normalizeLabData(labData, options.unitSystem) : labData;

    const results = { nutrients: {}, calculated: {}, diagnostics: [], alerts: [], pMethod: options?.pMethod || 'default' };

    // Determine texture group early (needed for P classification)
    let textureGroup = 2; // default Franco
    if (data.clay !== undefined) {
      const clay = parseFloat(data.clay) || 0;
      if (clay > 60) textureGroup = 4;
      else if (clay > 35) textureGroup = 3;
      else if (clay > 15) textureGroup = 2;
      else textureGroup = 1;
    }

    const classOpts = { pMethod: options?.pMethod, phMethod: options?.phMethod, textureGroup };

    // Classify each nutrient
    const soilNutrients = ['pH_H2O','MO','P','K','Ca','Mg','S','B','Cu','Fe','Mn','Zn','Al'];
    for (const n of soilNutrients) {
      if (data[n] !== undefined && data[n] !== null && data[n] !== '') {
        const val = parseFloat(data[n]);
        const cls = this.classifySoil(n, val, cropId, classOpts);
        const info = NUTRIENT_INFO[n] || { label: n, unit: '', decimals: 1 };
        // Use display unit from unit system
        const displayUnit = this.getDisplayUnit(n, options?.unitSystem);
        // Display value in user's original units
        const displayVal = options?.unitSystem ? parseFloat(labData[n]) : val;

        results.nutrients[n] = {
          value: val,
          displayValue: displayVal,
          ...cls,
          ...info,
          unit: displayUnit
        };

        // Method annotation (P, K, Ca, Mg, S, B, etc. when using method-specific ranges)
        if (cls.method) {
          results.nutrients[n].methodLabel = cls.method;
        }

        // Generate alerts
        if (cls.class === 'mb' || cls.class === 'def') {
          results.alerts.push({ type: 'danger', nutrient: n, msg: `${info.label}: ${displayVal} ${displayUnit} - ${cls.label}. Requiere corrección urgente.` });
        } else if (cls.class === 'b') {
          results.alerts.push({ type: 'warning', nutrient: n, msg: `${info.label}: ${displayVal} ${displayUnit} - ${cls.label}. Fertilización de corrección recomendada.` });
        }
      }
    }

    // Calculate derived values (using normalized internal data)
    const K = parseFloat(data.K) || 0;
    const Ca = parseFloat(data.Ca) || 0;
    const Mg = parseFloat(data.Mg) || 0;
    const Al = parseFloat(data.Al) || 0;
    const H_Al = parseFloat(data.H_Al) || 0;

    // Sum of bases (SB)
    const SB = Ca + Mg + K;
    results.calculated.SB = { value: SB, label: 'Suma de bases (SB)', unit: 'mmolc/dm³' };

    // CTC (if not provided directly) — use normalized data, not raw labData
    let CTC = parseFloat(data.CTC) || 0;
    if (!CTC && H_Al > 0) {
      CTC = SB + H_Al;
    }
    if (CTC > 0) {
      results.calculated.CTC = { value: CTC, label: 'CTC', unit: 'mmolc/dm³' };
      const ctcClass = this.classifySoil('CTC', CTC, cropId);
      results.nutrients.CTC = { value: CTC, ...ctcClass, ...NUTRIENT_INFO.CTC };
    }

    // V% (base saturation) — use normalized data, not raw labData
    let V = parseFloat(data.V) || 0;
    if (!V && CTC > 0) {
      V = (SB / CTC) * 100;
    }
    if (V > 0) {
      results.calculated.V = { value: V, label: 'Saturación bases (V%)', unit: '%' };
      const vClass = this.classifySoil('V', V, cropId);
      results.nutrients.V = { value: V, ...vClass, ...NUTRIENT_INFO.V };
    }

    // m% (aluminum saturation)
    if (Al > 0 && SB > 0) {
      const mPct = (Al / (SB + Al)) * 100;
      results.calculated.m = { value: mPct, label: 'Saturación Al (m%)', unit: '%' };
      if (mPct > 20) {
        results.alerts.push({ type: 'danger', nutrient: 'Al', msg: `Saturación de Al: ${mPct.toFixed(1)}% - Tóxico para raíces. Requiere encalado.` });
      }
    }

    // Base proportions in CTC
    if (CTC > 0) {
      results.calculated.CaPct = { value: (Ca / CTC) * 100, label: 'Ca/CTC', unit: '%' };
      results.calculated.MgPct = { value: (Mg / CTC) * 100, label: 'Mg/CTC', unit: '%' };
      results.calculated.KPct = { value: (K / CTC) * 100, label: 'K/CTC', unit: '%' };
    }

    // Texture classification
    if (labData.sand !== undefined && labData.clay !== undefined) {
      const sand = parseFloat(labData.sand) || 0;
      const silt = parseFloat(labData.silt) || (100 - sand - (parseFloat(labData.clay) || 0));
      const clay = parseFloat(labData.clay) || 0;
      results.calculated.texture = TEXTURE_CLASSES.classify(sand, silt, clay);
    }

    return results;
  }

  // ==================== NUTRIENT RELATIONSHIPS ====================

  static analyzeRelationships(labData, cropId) {
    const results = [];
    const K = parseFloat(labData.K) || 0;
    const Ca = parseFloat(labData.Ca) || 0;
    const Mg = parseFloat(labData.Mg) || 0;
    const Fe = parseFloat(labData.Fe) || 0;
    const Mn = parseFloat(labData.Mn) || 0;
    const P = parseFloat(labData.P) || 0;
    const Zn = parseFloat(labData.Zn) || 0;
    const Cu = parseFloat(labData.Cu) || 0;
    const CTC = parseFloat(labData.CTC) || (Ca + Mg + K + (parseFloat(labData.H_Al) || 0));

    const pairs = {
      'Ca/Mg': Mg > 0 ? Ca / Mg : null,
      'Ca/K': K > 0 ? Ca / K : null,
      'Mg/K': K > 0 ? Mg / K : null,
      '(Ca+Mg)/K': K > 0 ? (Ca + Mg) / K : null,
      'Ca/CTC': CTC > 0 ? (Ca / CTC) * 100 : null,
      'Mg/CTC': CTC > 0 ? (Mg / CTC) * 100 : null,
      'K/CTC': CTC > 0 ? (K / CTC) * 100 : null,
      'Fe/Mn': Mn > 0 ? Fe / Mn : null,
      'P/Zn': Zn > 0 ? P / Zn : null,
      'Cu/Zn': Zn > 0 ? Cu / Zn : null
    };

    // Use crop-specific relationship ranges if available, else generic
    const cropRanges = cropId && CROP_RELATIONSHIP_RANGES[cropId] ? CROP_RELATIONSHIP_RANGES[cropId] : {};

    for (const [name, value] of Object.entries(pairs)) {
      if (value === null) continue;
      const ref = cropRanges[name] || NUTRIENT_RELATIONSHIPS[name];
      if (!ref) continue;

      let status = 'optimal';
      let diagnostic = 'Relación equilibrada';
      const [optMin, optMax] = ref.optimal;

      if (optMin !== null && value < optMin) {
        status = 'low';
        diagnostic = ref.low || 'Por debajo del rango óptimo';
      } else if (optMax !== null && value > optMax) {
        status = 'high';
        diagnostic = ref.high || 'Por encima del rango óptimo';
      }

      results.push({
        name,
        value: value,
        optMin, optMax,
        status,
        diagnostic,
        color: status === 'optimal' ? '#22c55e' : status === 'low' ? '#f97316' : '#ef4444'
      });
    }

    return results;
  }

  // ==================== LEAF ANALYSIS ====================

  static classifyLeaf(nutrient, value, cropId) {
    const crop = CROPS_DB[cropId];
    if (!crop || !crop.leaf || !crop.leaf[nutrient]) return { class: 'N/D', label: 'Sin datos', color: '#6b7280' };

    const ranges = crop.leaf[nutrient];
    for (const [cls, [min, max]] of Object.entries(ranges)) {
      if (value >= min && value < max) {
        return {
          class: cls,
          label: CLASS_LABELS[cls] || cls,
          color: CLASS_COLORS[cls] || '#6b7280',
          min, max
        };
      }
    }
    return { class: 'N/D', label: 'Fuera de rango', color: '#6b7280' };
  }

  static interpretLeaf(leafData, cropId) {
    const crop = CROPS_DB[cropId];
    if (!crop) return { error: 'Cultivo no encontrado' };

    const results = { nutrients: {}, alerts: [] };
    const leafNutrients = ['N','P','K','Ca','Mg','S','B','Cu','Fe','Mn','Zn'];

    for (const n of leafNutrients) {
      if (leafData[n] !== undefined && leafData[n] !== null && leafData[n] !== '') {
        const val = parseFloat(leafData[n]);
        const cls = this.classifyLeaf(n, val, cropId);
        const isMacro = ['N','P','K','Ca','Mg','S'].includes(n);
        results.nutrients[n] = {
          value: val,
          ...cls,
          label: n,
          unit: isMacro ? 'g/kg' : 'mg/kg'
        };

        if (cls.class === 'def') {
          results.alerts.push({ type: 'danger', nutrient: n, msg: `${n} foliar: ${val} ${isMacro ? 'g/kg' : 'mg/kg'} - Deficiente. Corrección foliar urgente.` });
        } else if (cls.class === 'b') {
          results.alerts.push({ type: 'warning', nutrient: n, msg: `${n} foliar: ${val} ${isMacro ? 'g/kg' : 'mg/kg'} - Bajo. Considerar corrección.` });
        } else if (cls.class === 'ex') {
          results.alerts.push({ type: 'warning', nutrient: n, msg: `${n} foliar: ${val} ${isMacro ? 'g/kg' : 'mg/kg'} - Excesivo. Posible toxicidad.` });
        }
      }
    }

    return results;
  }

  // ==================== CROSS DIAGNOSIS SOIL-LEAF ====================

  static crossDiagnosis(soilInterpretation, leafInterpretation) {
    const diagnostics = [];
    const soilN = soilInterpretation?.nutrients || {};
    const leafN = leafInterpretation?.nutrients || {};

    const pairs = [
      { soil: 'P', leaf: 'P', name: 'Fósforo' },
      { soil: 'K', leaf: 'K', name: 'Potasio' },
      { soil: 'Ca', leaf: 'Ca', name: 'Calcio' },
      { soil: 'Mg', leaf: 'Mg', name: 'Magnesio' },
      { soil: 'S', leaf: 'S', name: 'Azufre' },
      { soil: 'B', leaf: 'B', name: 'Boro' },
      { soil: 'Cu', leaf: 'Cu', name: 'Cobre' },
      { soil: 'Fe', leaf: 'Fe', name: 'Hierro' },
      { soil: 'Mn', leaf: 'Mn', name: 'Manganeso' },
      { soil: 'Zn', leaf: 'Zn', name: 'Zinc' }
    ];

    for (const { soil, leaf, name } of pairs) {
      const s = soilN[soil];
      const l = leafN[leaf];
      if (!s || !l) continue;

      const sLevel = s.class;
      const lLevel = l.class;

      // Concordant: both low or both adequate
      if ((sLevel === 'mb' || sLevel === 'b') && (lLevel === 'def' || lLevel === 'b')) {
        diagnostics.push({
          nutrient: name, type: 'concordant-low', color: '#ef4444',
          msg: `${name}: bajo en suelo Y hoja. Deficiencia confirmada. Priorizar fertilización edáfica + foliar.`
        });
      } else if ((sLevel === 'a' || sLevel === 'ma') && (lLevel === 'ad' || lLevel === 'a')) {
        diagnostics.push({
          nutrient: name, type: 'concordant-ok', color: '#22c55e',
          msg: `${name}: adecuado en suelo y hoja. Mantenimiento suficiente.`
        });
      } else if ((sLevel === 'a' || sLevel === 'ma') && (lLevel === 'def' || lLevel === 'b')) {
        diagnostics.push({
          nutrient: name, type: 'discordant', color: '#f97316',
          msg: `${name}: alto en suelo pero bajo en hoja. Posible problema de absorción (pH, antagonismo, raíz).`
        });
      } else if ((sLevel === 'mb' || sLevel === 'b') && (lLevel === 'ad' || lLevel === 'a')) {
        diagnostics.push({
          nutrient: name, type: 'discordant', color: '#eab308',
          msg: `${name}: bajo en suelo pero adecuado en hoja. Reserva del suelo se está agotando. Fertilizar preventivamente.`
        });
      }
    }

    return diagnostics;
  }

  // ==================== AMENDMENT CALCULATIONS ====================

  // Liming calculation (base saturation method)
  static calculateLiming(labData, cropId, limingSource = 'calDolomita') {
    const crop = CROPS_DB[cropId];
    if (!crop) return null;

    const targetV = crop.targetV || 60;
    const currentV = parseFloat(labData.V) || 0;
    const CTC = parseFloat(labData.CTC) || 0;

    if (currentV >= targetV || CTC <= 0) {
      return { needed: false, dose_t_ha: 0, msg: 'V% actual es suficiente. No requiere encalado.' };
    }

    const source = FERTILIZER_SOURCES[limingSource] || FERTILIZER_SOURCES.calDolomita;
    const PRNT = source.PRNT || 80;

    // NC (t/ha) = (V2 - V1) x CTC / (10 x PRNT)
    // CTC in mmolc/dm³, V in %, PRNT in %
    const NC = ((targetV - currentV) * CTC) / (10 * PRNT);

    return {
      needed: true,
      dose_t_ha: Math.round(NC * 100) / 100,
      source: source.name,
      PRNT: PRNT,
      targetV: targetV,
      currentV: currentV,
      CTC: CTC,
      Ca_applied_kg: NC * 1000 * (source.Ca / 100),
      Mg_applied_kg: NC * 1000 * (source.Mg / 100),
      msg: `Aplicar ${NC.toFixed(2)} t/ha de ${source.name} (PRNT ${PRNT}%) para elevar V% de ${currentV.toFixed(0)}% a ${targetV}%.`
    };
  }

  // Gypsum calculation
  static calculateGypsum(labData, cropId) {
    const Ca_sub = parseFloat(labData.Ca_sub) || 0; // Ca subsuperficial (20-40cm)
    const Al_sub = parseFloat(labData.Al_sub) || 0;
    const clay = parseFloat(labData.clay) || 30;

    // Gypsum needed if Ca < 4 mmolc/dm³ or Al > 5 mmolc/dm³ in 20-40cm
    const needsGypsum = Ca_sub < 4 || Al_sub > 5;

    if (!needsGypsum && Ca_sub > 0) {
      return { needed: false, dose_t_ha: 0, msg: 'Subsuelo sin restricción química. No requiere yeso.' };
    }

    // NG (t/ha) = 6 x clay(%) / 100
    const NG = 6 * clay / 100;

    return {
      needed: true,
      dose_t_ha: Math.round(NG * 100) / 100,
      Ca_sub, Al_sub,
      msg: `Aplicar ${NG.toFixed(2)} t/ha de yeso agrícola para mejorar subsuelo (arcilla: ${clay}%).`
    };
  }

  // ==================== FERTILIZATION RECOMMENDATIONS ====================

  // Get yield profile for a crop at a given yield target
  static getYieldProfile(crop, yieldTarget) {
    if (!crop.yieldProfiles || !crop.yieldProfiles.length) {
      return { label: 'Default', extractionMult: 1.0, efficiencyMult: 1.0 };
    }
    // Find matching profile by yield range
    for (const profile of crop.yieldProfiles) {
      if (yieldTarget >= profile.range[0] && yieldTarget < profile.range[1]) {
        return profile;
      }
    }
    // If above max range, use last (highest) profile
    if (yieldTarget >= crop.yieldProfiles[crop.yieldProfiles.length - 1].range[1]) {
      return crop.yieldProfiles[crop.yieldProfiles.length - 1];
    }
    // If below min range, use first (lowest) profile
    return crop.yieldProfiles[0];
  }

  // Base micronutrient doses (kg/ha) by soil class at default yield
  static _baseMicroDose(micro, soilClass) {
    const baseDoses = {
      mb: { B: 3.0, Cu: 3.0, Fe: 10.0, Mn: 8.0, Zn: 6.0 },
      b:  { B: 2.0, Cu: 2.0, Fe: 6.0,  Mn: 5.0, Zn: 4.0 },
      m:  { B: 1.0, Cu: 1.0, Fe: 3.0,  Mn: 3.0, Zn: 2.0 }
    };
    return baseDoses[soilClass]?.[micro] || 0;
  }

  static calculateFertilization(labData, cropId, yieldTarget) {
    const crop = CROPS_DB[cropId];
    if (!crop) return { error: 'Cultivo no encontrado' };

    yieldTarget = yieldTarget || crop.defaultYield;

    // Get yield profile: adjusts extraction and efficiency based on yield tier
    const yieldProfile = this.getYieldProfile(crop, yieldTarget);
    const extractionMult = yieldProfile.extractionMult;
    const efficiencyMult = yieldProfile.efficiencyMult;

    const results = {
      crop: crop.name,
      yieldTarget,
      yieldUnit: crop.yieldUnit,
      yieldProfile: yieldProfile.label,
      yieldRange: crop.yieldRange,
      nutrients: [],
      warnings: []
    };

    // Warn if yield target is near or beyond crop limits
    if (yieldTarget > crop.yieldRange[1] * 0.95) {
      results.warnings.push(`Rendimiento objetivo (${yieldTarget} ${crop.yieldUnit}) cercano al máximo del cultivo. Verificar viabilidad agronómica.`);
    }

    // For each macronutrient, calculate demand - supply = net need
    const macros = ['N', 'P2O5', 'K2O', 'Ca', 'Mg', 'S'];

    for (const nutrient of macros) {
      // Base extraction coefficient (kg nutrient / ton product)
      const baseExtraction = crop.extraction[nutrient] || 0;

      // Adjusted extraction: scales with yield profile
      // Higher yields = slightly more extraction per ton (luxury consumption, diminishing returns)
      const adjustedExtractionPerTon = baseExtraction * extractionMult;

      // Total demand = adjusted extraction per ton × yield target
      const extraction = adjustedExtractionPerTon * yieldTarget;

      // Soil supply estimation
      let soilSupply = 0;
      const soilKey = this._nutrientToSoilKey(nutrient);
      const soilValue = parseFloat(labData[soilKey]) || 0;
      const cls = this.classifySoil(soilKey, soilValue, cropId);

      // Supply factor based on soil fertility class
      const supplyFactors = { mb: 0.0, b: 0.15, m: 0.40, a: 0.70, ma: 1.0 };
      const supplyFactor = supplyFactors[cls.class] !== undefined ? supplyFactors[cls.class] : 0.3;
      soilSupply = extraction * supplyFactor;

      // Special case: soja N from biological fixation (Bradyrhizobium)
      // Fixation efficiency depends on soil conditions (pH, Al saturation)
      if (crop.id === 'soja' && nutrient === 'N') {
        let fixationRate = 0.85; // 85% default from BNF in good conditions
        const pH = parseFloat(labData.pH_H2O) || 0;
        const Al = parseFloat(labData.Al) || 0;
        const SB = (parseFloat(labData.Ca) || 0) + (parseFloat(labData.Mg) || 0) + (parseFloat(labData.K) || 0);
        const mPct = (Al > 0 && SB > 0) ? (Al / (SB + Al)) * 100 : 0;

        // Reduce fixation under stress: low pH or high Al saturation
        if (pH > 0 && pH < 5.0) fixationRate *= 0.75;
        else if (pH >= 5.0 && pH < 5.5) fixationRate *= 0.90;
        if (mPct > 20) fixationRate *= 0.80;
        else if (mPct > 10) fixationRate *= 0.90;

        soilSupply = extraction * Math.min(fixationRate, 0.90);
        if (fixationRate < 0.75) {
          results.warnings.push('Fijación biológica de N reducida por pH bajo o Al elevado. Considerar encalar antes de sembrar soja.');
        }
      }

      // Net need
      const netNeed = Math.max(0, extraction - soilSupply);

      // Efficiency correction: adjusted by yield profile
      // Higher yields → lower absorption efficiency (diminishing returns)
      const baseEfficiency = crop.efficiency[nutrient] || 0.50;
      const efficiency = Math.max(0.10, Math.min(0.95, baseEfficiency * efficiencyMult));
      const doseKgHa = netNeed / efficiency;

      results.nutrients.push({
        nutrient,
        label: this._nutrientLabel(nutrient),
        extractionPerTon: Math.round(adjustedExtractionPerTon * 1000) / 1000,
        extraction: Math.round(extraction * 10) / 10,
        soilSupply: Math.round(soilSupply * 10) / 10,
        soilLevel: cls.label,
        soilClass: cls.class,
        netNeed: Math.round(netNeed * 10) / 10,
        efficiency: Math.round(efficiency * 100),
        doseKgHa: Math.round(doseKgHa * 10) / 10,
        doseGPlant: crop.perennial && crop.plantsPerHa
          ? Math.round((doseKgHa / crop.plantsPerHa) * 1000 * 10) / 10
          : null,
        unit: 'kg/ha'
      });
    }

    // Micronutrient recommendations — now yield-dependent
    // Yield ratio = how far above/below default yield the target is
    const yieldRatio = yieldTarget / (crop.defaultYield || 1);
    const micros = ['B', 'Cu', 'Fe', 'Mn', 'Zn'];

    for (const micro of micros) {
      const soilValue = parseFloat(labData[micro]) || 0;
      const cls = this.classifySoil(micro, soilValue, cropId);

      const baseDose = this._baseMicroDose(micro, cls.class);
      if (baseDose <= 0) continue; // Alto/Muy alto: no application needed

      // Scale micronutrient dose with yield ratio:
      // Higher yield targets need proportionally more micronutrients
      // Capped at 1.5x base dose to avoid over-application
      const yieldFactor = Math.min(1.5, Math.max(0.7, yieldRatio));
      const dose = Math.round(baseDose * yieldFactor * 10) / 10;

      results.nutrients.push({
        nutrient: micro,
        label: micro,
        soilLevel: cls.label,
        soilClass: cls.class,
        doseKgHa: dose,
        baseDose: baseDose,
        yieldFactor: Math.round(yieldFactor * 100) / 100,
        doseGPlant: crop.perennial && crop.plantsPerHa
          ? Math.round((dose / crop.plantsPerHa) * 1000 * 10) / 10
          : null,
        unit: 'kg/ha',
        isMicro: true
      });
    }

    return results;
  }

  // Calculate product quantities from nutrient doses
  static calculateProducts(fertResult, selectedSources) {
    const products = [];

    // Default sources if none selected
    const sources = selectedSources || {
      N: 'urea', P2O5: 'sft', K2O: 'kcl', S: 'sulfatoAmonio',
      B: 'acidoBorico', Cu: 'sulfatoCu', Fe: 'sulfatoFe', Mn: 'sulfatoMn', Zn: 'sulfatoZn'
    };

    for (const item of fertResult.nutrients) {
      if (item.doseKgHa <= 0) continue;

      const sourceKey = sources[item.nutrient] || sources[item.nutrient];
      const source = FERTILIZER_SOURCES[sourceKey];
      if (!source) continue;

      // Calculate product amount
      const nutrientContent = source[item.nutrient] || 0;
      if (nutrientContent <= 0) continue;

      const productKgHa = (item.doseKgHa / nutrientContent) * 100;

      products.push({
        nutrient: item.nutrient,
        label: item.label || item.nutrient,
        source: source.name,
        nutrientDose: item.doseKgHa,
        productKgHa: Math.round(productKgHa),
        nutrientContent: nutrientContent,
        unit: 'kg/ha'
      });
    }

    return products;
  }

  // ==================== FULL REPORT ====================

  static generateFullReport(soilData, leafData, cropId, yieldTarget, areaHa) {
    const crop = CROPS_DB[cropId];
    if (!crop) return { error: 'Cultivo no encontrado' };

    const report = {
      crop: { ...crop, extraction: undefined, exportt: undefined, soil: undefined, leaf: undefined },
      yieldTarget: yieldTarget || crop.defaultYield,
      area_ha: areaHa || 1,
      timestamp: new Date().toISOString(),
      soilInterpretation: null,
      relationships: null,
      leafInterpretation: null,
      crossDiagnosis: null,
      liming: null,
      gypsum: null,
      fertilization: null,
      products: null,
      totalCosts: null
    };

    // Soil interpretation — normalize once, reuse for all calculations
    if (soilData && Object.keys(soilData).length > 0) {
      report.soilInterpretation = this.interpretSoil(soilData, cropId);
      const normSoil = this.normalizeLabData ? this.normalizeLabData(soilData) : soilData;
      report.relationships = this.analyzeRelationships(normSoil);
      report.liming = this.calculateLiming(normSoil, cropId);
      report.gypsum = this.calculateGypsum(normSoil, cropId);
      report.fertilization = this.calculateFertilization(normSoil, cropId, report.yieldTarget);
      report.products = this.calculateProducts(report.fertilization);
    }

    // Leaf interpretation
    if (leafData && Object.keys(leafData).length > 0) {
      report.leafInterpretation = this.interpretLeaf(leafData, cropId);
    }

    // Cross diagnosis
    if (report.soilInterpretation && report.leafInterpretation) {
      report.crossDiagnosis = this.crossDiagnosis(report.soilInterpretation, report.leafInterpretation);
    }

    // Total quantities for the area
    if (report.products && areaHa > 0) {
      report.totalProducts = report.products.map(p => ({
        ...p,
        totalKg: Math.round(p.productKgHa * areaHa),
        totalBags: Math.ceil((p.productKgHa * areaHa) / 50) // 50 kg bags
      }));
    }

    return report;
  }

  // ==================== DRIS (Diagnosis and Recommendation Integrated System) ====================

  // Calculate DRIS indices for leaf analysis
  static calculateDRIS(leafData, cropId) {
    const norms = this._getNormsForCrop(cropId);
    if (!norms) return { error: 'Sin normas DRIS para este cultivo', indices: {}, order: [] };

    const nutrients = this._getDrisNutrients().filter(n => leafData[n] !== undefined && leafData[n] !== null);
    if (nutrients.length < 3) return { error: 'Se requieren al menos 3 nutrientes foliares', indices: {}, order: [] };

    // Build all pairwise functions f(A/B) — Jones (1981) asymmetric DRIS
    // f(A/B) = ((A/B)/(a/b) - 1) * 1000/CV  when A/B > a/b
    // f(A/B) = (1 - (a/b)/(A/B)) * 1000/CV  when A/B < a/b
    const functions = {};

    for (const [ratio, norm] of Object.entries(norms)) {
      const parts = ratio.split('/');
      if (parts.length !== 2) continue;
      const [A, B] = parts;
      if (leafData[A] === undefined || leafData[B] === undefined) continue;
      if (parseFloat(leafData[B]) === 0) continue;

      const observed = parseFloat(leafData[A]) / parseFloat(leafData[B]);
      if (observed === 0) continue;
      const normRatio = norm.mean;
      const cv = (norm.std / normRatio) * 100;
      if (cv === 0) continue;
      // Jones (1981) asymmetric function
      let f;
      if (observed > normRatio) {
        f = ((observed / normRatio) - 1) * (1000 / cv);
      } else {
        f = (1 - (normRatio / observed)) * (1000 / cv);
      }

      functions[ratio] = { A, B, observed, norm_mean: normRatio, norm_std: norm.std, f };
    }

    // Calculate index for each nutrient: I(A) = [Σf(A/B) - Σf(B/A)] / n
    const indices = {};
    for (const n of nutrients) {
      let sum = 0;
      let count = 0;

      for (const [ratio, data] of Object.entries(functions)) {
        if (data.A === n) {
          sum += data.f;
          count++;
        } else if (data.B === n) {
          sum -= data.f;
          count++;
        }
      }

      indices[n] = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
    }

    // Nutrient Balance Index (IBN) = Σ|indices|
    const ibn = Object.values(indices).reduce((s, v) => s + Math.abs(v), 0);
    const ibnm = nutrients.length > 0 ? Math.round((ibn / nutrients.length) * 10) / 10 : 0;

    // Order of limitation (most negative = most limiting)
    const order = Object.entries(indices)
      .sort((a, b) => a[1] - b[1])
      .map(([nutrient, index]) => {
        let status = 'equilibrado';
        if (index < -10) status = 'deficiente';
        else if (index < -5) status = 'limitante';
        else if (index > 10) status = 'excesivo';
        else if (index > 5) status = 'consumo lujoso';
        return { nutrient, index, status };
      });

    return {
      indices,
      order,
      ibn: Math.round(ibn * 10) / 10,
      ibnm,
      balanced: ibnm < 20, // IBNm < 20 = reasonably balanced
      ratioDetails: functions
    };
  }

  // ==================== CND (Compositional Nutrient Diagnosis) ====================
  // Parent & Dafir (1992) - Log-ratio approach, superior to DRIS for multi-nutrient

  static calculateCND(leafData, cropId) {
    const norms = this._getNormsForCrop(cropId);
    if (!norms) return { error: 'Sin normas para este cultivo', indices: {}, order: [] };

    const nutrients = this._getDrisNutrients().filter(n => leafData[n] !== undefined && leafData[n] !== null && parseFloat(leafData[n]) > 0);
    if (nutrients.length < 3) return { error: 'Se requieren al menos 3 nutrientes foliares positivos', indices: {}, order: [] };

    // Step 1: Geometric mean of all nutrient concentrations
    const values = nutrients.map(n => parseFloat(leafData[n]));
    const logSum = values.reduce((s, v) => s + Math.log(v), 0);
    const gMean = Math.exp(logSum / nutrients.length);

    // Step 2: Row-centered log-ratios (clr transform)
    const clr = {};
    for (let i = 0; i < nutrients.length; i++) {
      clr[nutrients[i]] = Math.log(values[i] / gMean);
    }

    // Step 3: CND indices using norm mean/std of log-ratios
    // Approximate from DRIS norms: use mean ratio norms to derive expected clr
    const indices = {};
    for (const n of nutrients) {
      // Simple CND: standardize the clr value
      // Use nutrient concentration norms if available, otherwise use ratio-derived
      let normMean = 0;
      let normStd = 1;
      let count = 0;

      for (const [ratio, norm] of Object.entries(norms)) {
        const [A, B] = ratio.split('/');
        if (A === n && nutrients.includes(B)) {
          normMean += Math.log(norm.mean);
          normStd = Math.max(normStd, norm.std / norm.mean);
          count++;
        } else if (B === n && nutrients.includes(A)) {
          normMean -= Math.log(norm.mean);
          count++;
        }
      }

      if (count > 0) normMean /= count;
      indices[n] = Math.round(((clr[n] - normMean) / normStd) * 10) / 10;
    }

    // CND r² (imbalance index, analogous to IBN)
    const r2 = Object.values(indices).reduce((s, v) => s + v * v, 0);
    const r2m = nutrients.length > 0 ? Math.round((r2 / nutrients.length) * 10) / 10 : 0;

    const order = Object.entries(indices)
      .map(([nutrient, index]) => {
        let status = 'adecuado';
        if (index < -10) status = 'deficiente';
        else if (index < -5) status = 'limitante';
        else if (index > 10) status = 'excesivo';
        else if (index > 5) status = 'consumo lujoso';
        return { nutrient, index, status };
      })
      .sort((a, b) => a.index - b.index);

    return {
      method: 'CND',
      indices,
      order,
      r2: Math.round(r2 * 10) / 10,
      r2m,
      balanced: r2m < 20,
      clrValues: clr
    };
  }

  // ==================== HELPERS ====================

  static _nutrientToSoilKey(nutrient) {
    const map = { 'N': 'MO', 'P2O5': 'P', 'K2O': 'K' };
    return map[nutrient] || nutrient;
  }

  static _nutrientLabel(nutrient) {
    const labels = {
      'N': 'Nitrógeno (N)', 'P2O5': 'Fósforo (P₂O₅)', 'K2O': 'Potasio (K₂O)',
      'Ca': 'Calcio (Ca)', 'Mg': 'Magnesio (Mg)', 'S': 'Azufre (S)',
      'B': 'Boro (B)', 'Cu': 'Cobre (Cu)', 'Fe': 'Hierro (Fe)',
      'Mn': 'Manganeso (Mn)', 'Zn': 'Zinc (Zn)'
    };
    return labels[nutrient] || nutrient;
  }

  // Get all available crop IDs with yield info
  static getCropList() {
    return Object.values(CROPS_DB).map(c => ({
      id: c.id,
      name: c.name,
      scientific: c.scientific,
      yieldUnit: c.yieldUnit,
      yieldRange: c.yieldRange,
      defaultYield: c.defaultYield,
      yieldProfiles: c.yieldProfiles || []
    }));
  }

  // Get yield profiles for a specific crop
  static getYieldProfiles(cropId) {
    const crop = CROPS_DB[cropId];
    if (!crop) return [];
    return (crop.yieldProfiles || []).map(p => ({
      ...p,
      isDefault: p.range[0] <= crop.defaultYield && crop.defaultYield < p.range[1]
    }));
  }
}

// Static cache properties for DRIS/IBRA norms loaded from ibra-norms.json
InterpretationEngine._drisNorms         = null; // { cropId: { 'N/P': { mean, std }, ... } }
InterpretationEngine._drisNutrients     = null; // ['N','P','K','Ca','Mg','S','B','Cu','Fe','Mn','Zn']
InterpretationEngine._drisCachePromise  = null; // In-flight fetch Promise (deduplicates concurrent calls)
