// PIX Admin - Crop Database
// Complete agronomic data for 11 crops: sufficiency ranges, extraction, relationships
// Based on: Raij (1997), Malavolta (2006), EMBRAPA, IPA, CIAT, INTA references

const CROPS_DB = {

  // ==================== CAÑA DE AZÚCAR ====================
  cana: {
    id: 'cana', name: 'Caña de azúcar', scientific: 'Saccharum officinarum',
    yieldUnit: 't caña/ha', yieldRange: [40, 200], defaultYield: 100,
    // Yield profiles: extraction multiplier & efficiency adjustment by yield tier
    // At higher yields, extraction per ton may increase (luxury consumption) and efficiency may decrease
    yieldProfiles: [
      { label: 'Bajo (<60 t/ha)',      range: [40, 60],   extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (60-100 t/ha)',   range: [60, 100],  extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (100-140 t/ha)',   range: [100, 140], extractionMult: 1.05, efficiencyMult: 0.95 },
      { label: 'Muy alto (>140 t/ha)',  range: [140, 200], extractionMult: 1.12, efficiencyMult: 0.90 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] }, // g/dm³
      P:       { mb: [0,6], b: [6,12], m: [12,20], a: [20,40], ma: [40,999] }, // mg/dm³ Mehlich-1
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] }, // mmolc/dm³
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.6], a: [0.6,1.0], ma: [1.0,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] }, // %
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // TVD (Top Visible Dewlap) leaf, 4-6 months
      N: { def: [0,18], b: [18,20], ad: [20,22], a: [22,25], ex: [25,99] }, // g/kg
      P: { def: [0,1.5], b: [1.5,1.8], ad: [1.8,2.5], a: [2.5,3.0], ex: [3.0,99] },
      K: { def: [0,10], b: [10,12], ad: [12,16], a: [16,20], ex: [20,99] },
      Ca: { def: [0,2.0], b: [2.0,3.0], ad: [3.0,5.0], a: [5.0,8.0], ex: [8.0,99] },
      Mg: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,3.0], a: [3.0,5.0], ex: [5.0,99] },
      S: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,2.5], a: [2.5,4.0], ex: [4.0,99] },
      B: { def: [0,5], b: [5,10], ad: [10,25], a: [25,40], ex: [40,999] }, // mg/kg
      Cu: { def: [0,3], b: [3,5], ad: [5,10], a: [10,20], ex: [20,999] },
      Fe: { def: [0,40], b: [40,60], ad: [60,200], a: [200,300], ex: [300,9999] },
      Mn: { def: [0,15], b: [15,25], ad: [25,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,10], b: [10,15], ad: [15,30], a: [30,50], ex: [50,999] }
    },
    extraction: { // kg nutriente por tonelada de caña (tallos + hojas)
      N: 1.10, P2O5: 0.40, K2O: 1.50, Ca: 0.50, Mg: 0.30, S: 0.20,
      B: 0.002, Cu: 0.001, Fe: 0.015, Mn: 0.005, Zn: 0.002
    },
    exportt: { // kg nutriente exportado por tonelada de caña (solo tallos)
      N: 0.50, P2O5: 0.15, K2O: 0.80, Ca: 0.15, Mg: 0.12, S: 0.10
    },
    efficiency: { N: 0.60, P2O5: 0.25, K2O: 0.70, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 5.5
  },

  // ==================== SOJA ====================
  soja: {
    id: 'soja', name: 'Soja', scientific: 'Glycine max',
    yieldUnit: 't/ha', yieldRange: [1.5, 5.0], defaultYield: 3.0,
    yieldProfiles: [
      { label: 'Bajo (<2.0 t/ha)',     range: [1.5, 2.0], extractionMult: 0.92, efficiencyMult: 1.10 },
      { label: 'Medio (2.0-3.5 t/ha)', range: [2.0, 3.5], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (3.5-4.5 t/ha)',  range: [3.5, 4.5], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>4.5 t/ha)', range: [4.5, 5.0], extractionMult: 1.15, efficiencyMult: 0.85 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] },
      P:       { mb: [0,3], b: [3,6], m: [6,12], a: [12,25], ma: [25,999] },
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.6], a: [0.6,1.0], ma: [1.0,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] },
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // Hoja trifoliada completa (R2 - floración plena)
      N: { def: [0,40], b: [40,45], ad: [45,55], a: [55,60], ex: [60,99] },
      P: { def: [0,2.0], b: [2.0,2.5], ad: [2.5,5.0], a: [5.0,7.0], ex: [7.0,99] },
      K: { def: [0,14], b: [14,17], ad: [17,25], a: [25,30], ex: [30,99] },
      Ca: { def: [0,3.5], b: [3.5,5.0], ad: [5.0,12], a: [12,20], ex: [20,99] },
      Mg: { def: [0,1.5], b: [1.5,2.5], ad: [2.5,5.0], a: [5.0,10], ex: [10,99] },
      S: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,4.0], a: [4.0,6.0], ex: [6.0,99] },
      B: { def: [0,15], b: [15,21], ad: [21,55], a: [55,80], ex: [80,999] },
      Cu: { def: [0,5], b: [5,7], ad: [7,14], a: [14,25], ex: [25,999] },
      Fe: { def: [0,30], b: [30,50], ad: [50,350], a: [350,500], ex: [500,9999] },
      Mn: { def: [0,15], b: [15,20], ad: [20,100], a: [100,250], ex: [250,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 80, P2O5: 16, K2O: 40, Ca: 6.0, Mg: 3.5, S: 5.5, B: 0.04, Cu: 0.03, Fe: 0.40, Mn: 0.08, Zn: 0.05 },
    exportt:    { N: 60, P2O5: 12, K2O: 20, Ca: 3.0, Mg: 2.0, S: 3.0 },
    efficiency: { N: 0.50, P2O5: 0.20, K2O: 0.65, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 5.5,
    notes: 'N fijado por Bradyrhizobium. Fertilización N solo arrancador (0-20 kg/ha).'
  },

  // ==================== MAÍZ ====================
  maiz: {
    id: 'maiz', name: 'Maíz', scientific: 'Zea mays',
    yieldUnit: 't/ha', yieldRange: [3, 14], defaultYield: 8,
    yieldProfiles: [
      { label: 'Bajo (<5 t/ha)',      range: [3, 5],   extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (5-8 t/ha)',    range: [5, 8],   extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (8-11 t/ha)',    range: [8, 11],  extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>11 t/ha)', range: [11, 14], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] },
      P:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,30], ma: [30,999] },
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.6], a: [0.6,1.0], ma: [1.0,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] },
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // Hoja opuesta e inferior a la espiga, en floración
      N: { def: [0,22], b: [22,27], ad: [27,35], a: [35,40], ex: [40,99] },
      P: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,4.0], a: [4.0,5.0], ex: [5.0,99] },
      K: { def: [0,14], b: [14,17], ad: [17,25], a: [25,35], ex: [35,99] },
      Ca: { def: [0,1.5], b: [1.5,2.5], ad: [2.5,8.0], a: [8.0,12], ex: [12,99] },
      Mg: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,4.0], a: [4.0,8.0], ex: [8.0,99] },
      S: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,3.0], a: [3.0,5.0], ex: [5.0,99] },
      B: { def: [0,5], b: [5,10], ad: [10,25], a: [25,50], ex: [50,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,15], a: [15,30], ex: [30,999] },
      Fe: { def: [0,30], b: [30,50], ad: [50,250], a: [250,400], ex: [400,9999] },
      Mn: { def: [0,15], b: [15,20], ad: [20,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,10], b: [10,15], ad: [15,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 25, P2O5: 10, K2O: 20, Ca: 3.5, Mg: 3.0, S: 2.5, B: 0.015, Cu: 0.01, Fe: 0.15, Mn: 0.03, Zn: 0.04 },
    exportt:    { N: 16, P2O5: 7, K2O: 5, Ca: 0.4, Mg: 1.5, S: 1.2 },
    efficiency: { N: 0.60, P2O5: 0.25, K2O: 0.70, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 5.5
  },

  // ==================== SORGO ====================
  sorgo: {
    id: 'sorgo', name: 'Sorgo granífero', scientific: 'Sorghum bicolor',
    yieldUnit: 't/ha', yieldRange: [2, 10], defaultYield: 5,
    yieldProfiles: [
      { label: 'Bajo (<3 t/ha)',     range: [2, 3],  extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (3-6 t/ha)',   range: [3, 6],  extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (6-8 t/ha)',    range: [6, 8],  extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>8 t/ha)', range: [8, 10], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] },
      P:       { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.6], a: [0.6,1.0], ma: [1.0,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] },
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: {
      N: { def: [0,20], b: [20,25], ad: [25,35], a: [35,40], ex: [40,99] },
      P: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,3.5], a: [3.5,5.0], ex: [5.0,99] },
      K: { def: [0,12], b: [12,15], ad: [15,22], a: [22,30], ex: [30,99] },
      Ca: { def: [0,2.0], b: [2.0,3.0], ad: [3.0,7.0], a: [7.0,12], ex: [12,99] },
      Mg: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,4.0], a: [4.0,7.0], ex: [7.0,99] },
      S: { def: [0,1.0], b: [1.0,1.5], ad: [1.5,3.0], a: [3.0,5.0], ex: [5.0,99] },
      B: { def: [0,4], b: [4,8], ad: [8,20], a: [20,40], ex: [40,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,12], a: [12,25], ex: [25,999] },
      Fe: { def: [0,30], b: [30,50], ad: [50,200], a: [200,400], ex: [400,9999] },
      Mn: { def: [0,10], b: [10,20], ad: [20,100], a: [100,250], ex: [250,9999] },
      Zn: { def: [0,10], b: [10,15], ad: [15,40], a: [40,80], ex: [80,999] }
    },
    extraction: { N: 30, P2O5: 8, K2O: 18, Ca: 3.0, Mg: 2.5, S: 2.0, B: 0.012, Cu: 0.008, Fe: 0.12, Mn: 0.025, Zn: 0.03 },
    exportt:    { N: 18, P2O5: 6, K2O: 4, Ca: 0.3, Mg: 1.0, S: 1.0 },
    efficiency: { N: 0.55, P2O5: 0.20, K2O: 0.65, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 50, targetpH: 5.5
  },

  // ==================== GIRASOL ====================
  girasol: {
    id: 'girasol', name: 'Girasol', scientific: 'Helianthus annuus',
    yieldUnit: 't/ha', yieldRange: [1.0, 3.5], defaultYield: 2.0,
    yieldProfiles: [
      { label: 'Bajo (<1.5 t/ha)',     range: [1.0, 1.5], extractionMult: 0.92, efficiencyMult: 1.10 },
      { label: 'Medio (1.5-2.5 t/ha)', range: [1.5, 2.5], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (2.5-3.0 t/ha)',  range: [2.5, 3.0], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>3.0 t/ha)', range: [3.0, 3.5], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] },
      P:       { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] },
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: {
      N: { def: [0,30], b: [30,35], ad: [35,50], a: [50,55], ex: [55,99] },
      P: { def: [0,2.0], b: [2.0,2.5], ad: [2.5,5.0], a: [5.0,7.0], ex: [7.0,99] },
      K: { def: [0,20], b: [20,25], ad: [25,40], a: [40,50], ex: [50,99] },
      Ca: { def: [0,10], b: [10,15], ad: [15,30], a: [30,45], ex: [45,99] },
      Mg: { def: [0,3], b: [3,5], ad: [5,10], a: [10,15], ex: [15,99] },
      S: { def: [0,2], b: [2,3], ad: [3,6], a: [6,10], ex: [10,99] },
      B: { def: [0,25], b: [25,35], ad: [35,80], a: [80,120], ex: [120,999] },
      Cu: { def: [0,5], b: [5,10], ad: [10,30], a: [30,50], ex: [50,999] },
      Fe: { def: [0,50], b: [50,80], ad: [80,300], a: [300,500], ex: [500,9999] },
      Mn: { def: [0,20], b: [20,30], ad: [30,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 45, P2O5: 18, K2O: 70, Ca: 8, Mg: 5, S: 4, B: 0.10, Cu: 0.02, Fe: 0.20, Mn: 0.06, Zn: 0.05 },
    exportt:    { N: 30, P2O5: 14, K2O: 15, Ca: 1.0, Mg: 2.0, S: 2.0 },
    efficiency: { N: 0.55, P2O5: 0.20, K2O: 0.65, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 5.8,
    notes: 'Alta exigencia en B. Sensible a deficiencia de B.'
  },

  // ==================== CHÍA ====================
  chia: {
    id: 'chia', name: 'Chía', scientific: 'Salvia hispanica',
    yieldUnit: 't/ha', yieldRange: [0.5, 2.0], defaultYield: 1.0,
    yieldProfiles: [
      { label: 'Bajo (<0.7 t/ha)',     range: [0.5, 0.7], extractionMult: 0.92, efficiencyMult: 1.10 },
      { label: 'Medio (0.7-1.2 t/ha)', range: [0.7, 1.2], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (1.2-1.6 t/ha)',  range: [1.2, 1.6], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>1.6 t/ha)', range: [1.6, 2.0], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,7.0], ma: [7.0,14] },
      MO:      { mb: [0,10], b: [10,20], m: [20,30], a: [30,50], ma: [50,999] },
      P:       { mb: [0,5], b: [5,10], m: [10,20], a: [20,35], ma: [35,999] },
      K:       { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      Ca:      { mb: [0,4], b: [4,10], m: [10,20], a: [20,40], ma: [40,999] },
      Mg:      { mb: [0,2], b: [2,5], m: [5,8], a: [8,15], ma: [15,999] },
      S:       { mb: [0,4], b: [4,7], m: [7,10], a: [10,15], ma: [15,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.6], a: [0.6,1.0], ma: [1.0,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Fe:      { mb: [0,5], b: [5,12], m: [12,30], a: [30,60], ma: [60,999] },
      Mn:      { mb: [0,1.5], b: [1.5,5], m: [5,10], a: [10,20], ma: [20,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,80], ma: [80,100] },
      CTC:     { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: {
      N: { def: [0,25], b: [25,30], ad: [30,45], a: [45,55], ex: [55,99] },
      P: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,4.0], a: [4.0,6.0], ex: [6.0,99] },
      K: { def: [0,12], b: [12,15], ad: [15,25], a: [25,35], ex: [35,99] },
      Ca: { def: [0,5], b: [5,8], ad: [8,18], a: [18,30], ex: [30,99] },
      Mg: { def: [0,2], b: [2,3], ad: [3,8], a: [8,12], ex: [12,99] },
      S: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,4.0], a: [4.0,6.0], ex: [6.0,99] },
      B: { def: [0,10], b: [10,15], ad: [15,40], a: [40,70], ex: [70,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,12], a: [12,25], ex: [25,999] },
      Fe: { def: [0,30], b: [30,50], ad: [50,200], a: [200,400], ex: [400,9999] },
      Mn: { def: [0,10], b: [10,20], ad: [20,100], a: [100,250], ex: [250,9999] },
      Zn: { def: [0,10], b: [10,15], ad: [15,40], a: [40,80], ex: [80,999] }
    },
    extraction: { N: 40, P2O5: 12, K2O: 30, Ca: 5, Mg: 3, S: 3, B: 0.02, Cu: 0.01, Fe: 0.10, Mn: 0.03, Zn: 0.03 },
    exportt:    { N: 30, P2O5: 9, K2O: 10, Ca: 1.5, Mg: 1.5, S: 2.0 },
    efficiency: { N: 0.50, P2O5: 0.20, K2O: 0.65, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 6.0
  },

  // ==================== TOMATE ====================
  tomate: {
    id: 'tomate', name: 'Tomate', scientific: 'Solanum lycopersicum',
    yieldUnit: 't/ha', yieldRange: [30, 150], defaultYield: 80,
    yieldProfiles: [
      { label: 'Bajo (<50 t/ha)',      range: [30, 50],  extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (50-80 t/ha)',   range: [50, 80],  extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (80-120 t/ha)',   range: [80, 120], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>120 t/ha)', range: [120, 150], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,15], b: [15,25], m: [25,40], a: [40,60], ma: [60,999] },
      P:       { mb: [0,10], b: [10,20], m: [20,40], a: [40,80], ma: [80,999] },
      K:       { mb: [0,1.5], b: [1.5,3.0], m: [3.0,5.0], a: [5.0,8.0], ma: [8.0,99] },
      Ca:      { mb: [0,8], b: [8,15], m: [15,30], a: [30,60], ma: [60,999] },
      Mg:      { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      S:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,20], ma: [20,999] },
      B:       { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Cu:      { mb: [0,0.5], b: [0.5,0.8], m: [0.8,1.2], a: [1.2,2.0], ma: [2.0,99] },
      Fe:      { mb: [0,8], b: [8,15], m: [15,35], a: [35,60], ma: [60,999] },
      Mn:      { mb: [0,2], b: [2,6], m: [6,12], a: [12,25], ma: [25,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.2], m: [1.2,3.0], a: [3.0,6.0], ma: [6.0,99] },
      V:       { mb: [0,35], b: [35,50], m: [50,70], a: [70,85], ma: [85,100] },
      CTC:     { mb: [0,30], b: [30,60], m: [60,100], a: [100,200], ma: [200,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // 4a hoja desde el ápice, inicio fructificación
      N: { def: [0,30], b: [30,40], ad: [40,60], a: [60,70], ex: [70,99] },
      P: { def: [0,2.0], b: [2.0,3.0], ad: [3.0,6.0], a: [6.0,8.0], ex: [8.0,99] },
      K: { def: [0,20], b: [20,30], ad: [30,50], a: [50,60], ex: [60,99] },
      Ca: { def: [0,10], b: [10,15], ad: [15,30], a: [30,50], ex: [50,99] },
      Mg: { def: [0,3], b: [3,4], ad: [4,8], a: [8,15], ex: [15,99] },
      S: { def: [0,2], b: [2,3], ad: [3,8], a: [8,12], ex: [12,99] },
      B: { def: [0,20], b: [20,30], ad: [30,80], a: [80,120], ex: [120,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,15], a: [15,30], ex: [30,999] },
      Fe: { def: [0,40], b: [40,60], ad: [60,300], a: [300,500], ex: [500,9999] },
      Mn: { def: [0,20], b: [20,30], ad: [30,200], a: [200,400], ex: [400,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,60], a: [60,120], ex: [120,999] }
    },
    extraction: { N: 2.5, P2O5: 0.8, K2O: 4.0, Ca: 1.5, Mg: 0.5, S: 0.3, B: 0.003, Cu: 0.002, Fe: 0.02, Mn: 0.005, Zn: 0.003 },
    exportt:    { N: 1.8, P2O5: 0.5, K2O: 2.5, Ca: 0.1, Mg: 0.15, S: 0.15 },
    efficiency: { N: 0.55, P2O5: 0.30, K2O: 0.70, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 70, targetpH: 6.0
  },

  // ==================== PIMENTÓN ====================
  pimenton: {
    id: 'pimenton', name: 'Pimentón / Ají', scientific: 'Capsicum annuum',
    yieldUnit: 't/ha', yieldRange: [15, 80], defaultYield: 40,
    yieldProfiles: [
      { label: 'Bajo (<25 t/ha)',     range: [15, 25], extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (25-45 t/ha)',  range: [25, 45], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (45-65 t/ha)',   range: [45, 65], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>65 t/ha)', range: [65, 80], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,15], b: [15,25], m: [25,40], a: [40,60], ma: [60,999] },
      P:       { mb: [0,10], b: [10,20], m: [20,35], a: [35,60], ma: [60,999] },
      K:       { mb: [0,1.5], b: [1.5,3.0], m: [3.0,5.0], a: [5.0,8.0], ma: [8.0,99] },
      Ca:      { mb: [0,8], b: [8,15], m: [15,30], a: [30,50], ma: [50,999] },
      Mg:      { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      S:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,20], ma: [20,999] },
      B:       { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Cu:      { mb: [0,0.5], b: [0.5,0.8], m: [0.8,1.2], a: [1.2,2.0], ma: [2.0,99] },
      Fe:      { mb: [0,8], b: [8,15], m: [15,35], a: [35,60], ma: [60,999] },
      Mn:      { mb: [0,2], b: [2,6], m: [6,12], a: [12,25], ma: [25,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.2], m: [1.2,3.0], a: [3.0,6.0], ma: [6.0,99] },
      V:       { mb: [0,35], b: [35,50], m: [50,70], a: [70,85], ma: [85,100] },
      CTC:     { mb: [0,30], b: [30,60], m: [60,100], a: [100,200], ma: [200,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: {
      N: { def: [0,25], b: [25,35], ad: [35,50], a: [50,60], ex: [60,99] },
      P: { def: [0,1.5], b: [1.5,2.5], ad: [2.5,5.0], a: [5.0,7.0], ex: [7.0,99] },
      K: { def: [0,18], b: [18,25], ad: [25,45], a: [45,55], ex: [55,99] },
      Ca: { def: [0,8], b: [8,12], ad: [12,25], a: [25,40], ex: [40,99] },
      Mg: { def: [0,2], b: [2,4], ad: [4,8], a: [8,12], ex: [12,99] },
      S: { def: [0,2], b: [2,3], ad: [3,7], a: [7,10], ex: [10,99] },
      B: { def: [0,15], b: [15,25], ad: [25,60], a: [60,100], ex: [100,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,15], a: [15,25], ex: [25,999] },
      Fe: { def: [0,40], b: [40,60], ad: [60,250], a: [250,400], ex: [400,9999] },
      Mn: { def: [0,20], b: [20,30], ad: [30,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 3.0, P2O5: 0.8, K2O: 4.5, Ca: 1.2, Mg: 0.4, S: 0.3, B: 0.003, Cu: 0.002, Fe: 0.02, Mn: 0.005, Zn: 0.003 },
    exportt:    { N: 2.0, P2O5: 0.5, K2O: 3.0, Ca: 0.15, Mg: 0.12, S: 0.15 },
    efficiency: { N: 0.55, P2O5: 0.30, K2O: 0.70, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 70, targetpH: 6.0
  },

  // ==================== PAPA ====================
  papa: {
    id: 'papa', name: 'Papa', scientific: 'Solanum tuberosum',
    yieldUnit: 't/ha', yieldRange: [15, 60], defaultYield: 30,
    yieldProfiles: [
      { label: 'Bajo (<20 t/ha)',     range: [15, 20], extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (20-35 t/ha)',  range: [20, 35], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (35-50 t/ha)',   range: [35, 50], extractionMult: 1.08, efficiencyMult: 0.93 },
      { label: 'Muy alto (>50 t/ha)', range: [50, 60], extractionMult: 1.15, efficiencyMult: 0.88 }
    ],
    soil: {
      pH_H2O:  { mb: [0,4.8], b: [4.8,5.3], m: [5.3,5.8], a: [5.8,6.3], ma: [6.3,14] },
      MO:      { mb: [0,15], b: [15,25], m: [25,40], a: [40,60], ma: [60,999] },
      P:       { mb: [0,10], b: [10,20], m: [20,40], a: [40,80], ma: [80,999] },
      K:       { mb: [0,1.5], b: [1.5,3.0], m: [3.0,5.0], a: [5.0,8.0], ma: [8.0,99] },
      Ca:      { mb: [0,8], b: [8,15], m: [15,30], a: [30,50], ma: [50,999] },
      Mg:      { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      S:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,20], ma: [20,999] },
      B:       { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.7], a: [0.7,1.2], ma: [1.2,99] },
      Cu:      { mb: [0,0.3], b: [0.3,0.6], m: [0.6,1.0], a: [1.0,2.0], ma: [2.0,99] },
      Fe:      { mb: [0,8], b: [8,15], m: [15,35], a: [35,60], ma: [60,999] },
      Mn:      { mb: [0,2], b: [2,6], m: [6,12], a: [12,25], ma: [25,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.2], m: [1.2,3.0], a: [3.0,6.0], ma: [6.0,99] },
      V:       { mb: [0,30], b: [30,45], m: [45,60], a: [60,75], ma: [75,100] },
      CTC:     { mb: [0,30], b: [30,60], m: [60,100], a: [100,200], ma: [200,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // 3a-4a hoja desde el ápice, inicio tuberización
      N: { def: [0,30], b: [30,40], ad: [40,55], a: [55,65], ex: [65,99] },
      P: { def: [0,2.0], b: [2.0,2.5], ad: [2.5,5.0], a: [5.0,7.0], ex: [7.0,99] },
      K: { def: [0,30], b: [30,40], ad: [40,60], a: [60,70], ex: [70,99] },
      Ca: { def: [0,5], b: [5,8], ad: [8,20], a: [20,35], ex: [35,99] },
      Mg: { def: [0,2], b: [2,3], ad: [3,8], a: [8,12], ex: [12,99] },
      S: { def: [0,2], b: [2,3], ad: [3,6], a: [6,10], ex: [10,99] },
      B: { def: [0,15], b: [15,25], ad: [25,60], a: [60,100], ex: [100,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,15], a: [15,30], ex: [30,999] },
      Fe: { def: [0,30], b: [30,50], ad: [50,200], a: [200,400], ex: [400,9999] },
      Mn: { def: [0,15], b: [15,25], ad: [25,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 4.5, P2O5: 1.5, K2O: 7.0, Ca: 1.0, Mg: 0.5, S: 0.4, B: 0.003, Cu: 0.002, Fe: 0.02, Mn: 0.005, Zn: 0.003 },
    exportt:    { N: 3.5, P2O5: 1.0, K2O: 5.5, Ca: 0.1, Mg: 0.15, S: 0.2 },
    efficiency: { N: 0.55, P2O5: 0.30, K2O: 0.75, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 60, targetpH: 5.5,
    notes: 'Sensible a sarna común con pH > 6.2. No encalar excesivamente.'
  },

  // ==================== MARACUYÁ ====================
  maracuya: {
    id: 'maracuya', name: 'Maracuyá', scientific: 'Passiflora edulis',
    yieldUnit: 't/ha', yieldRange: [10, 50], defaultYield: 25,
    perennial: true, spacing: '3x3m', plantsPerHa: 1111,
    yieldProfiles: [
      { label: 'Bajo (<15 t/ha)',     range: [10, 15], extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (15-30 t/ha)',  range: [15, 30], extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (30-40 t/ha)',   range: [30, 40], extractionMult: 1.10, efficiencyMult: 0.92 },
      { label: 'Muy alto (>40 t/ha)', range: [40, 50], extractionMult: 1.18, efficiencyMult: 0.85 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,15], b: [15,25], m: [25,40], a: [40,60], ma: [60,999] },
      P:       { mb: [0,8], b: [8,15], m: [15,30], a: [30,50], ma: [50,999] },
      K:       { mb: [0,1.5], b: [1.5,3.0], m: [3.0,5.0], a: [5.0,8.0], ma: [8.0,99] },
      Ca:      { mb: [0,8], b: [8,15], m: [15,30], a: [30,50], ma: [50,999] },
      Mg:      { mb: [0,4], b: [4,8], m: [8,15], a: [15,25], ma: [25,999] },
      S:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,20], ma: [20,999] },
      B:       { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Cu:      { mb: [0,0.5], b: [0.5,0.8], m: [0.8,1.5], a: [1.5,3.0], ma: [3.0,99] },
      Fe:      { mb: [0,8], b: [8,15], m: [15,35], a: [35,60], ma: [60,999] },
      Mn:      { mb: [0,2], b: [2,6], m: [6,12], a: [12,25], ma: [25,999] },
      Zn:      { mb: [0,0.5], b: [0.5,1.2], m: [1.2,3.0], a: [3.0,6.0], ma: [6.0,99] },
      V:       { mb: [0,35], b: [35,50], m: [50,70], a: [70,85], ma: [85,100] },
      CTC:     { mb: [0,30], b: [30,60], m: [60,100], a: [100,200], ma: [200,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
    leaf: { // 4a hoja desde el ápice del ramo productivo, floración
      N: { def: [0,35], b: [35,40], ad: [40,50], a: [50,55], ex: [55,99] },
      P: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,3.0], a: [3.0,5.0], ex: [5.0,99] },
      K: { def: [0,18], b: [18,22], ad: [22,35], a: [35,45], ex: [45,99] },
      Ca: { def: [0,8], b: [8,12], ad: [12,20], a: [20,35], ex: [35,99] },
      Mg: { def: [0,2], b: [2,3], ad: [3,5], a: [5,8], ex: [8,99] },
      S: { def: [0,2], b: [2,3], ad: [3,5], a: [5,8], ex: [8,99] },
      B: { def: [0,20], b: [20,30], ad: [30,60], a: [60,100], ex: [100,999] },
      Cu: { def: [0,5], b: [5,8], ad: [8,20], a: [20,40], ex: [40,999] },
      Fe: { def: [0,50], b: [50,80], ad: [80,250], a: [250,400], ex: [400,9999] },
      Mn: { def: [0,20], b: [20,30], ad: [30,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 6.0, P2O5: 1.5, K2O: 8.0, Ca: 2.0, Mg: 0.8, S: 0.5, B: 0.004, Cu: 0.002, Fe: 0.03, Mn: 0.005, Zn: 0.003 },
    exportt:    { N: 3.5, P2O5: 1.0, K2O: 5.0, Ca: 0.2, Mg: 0.15, S: 0.2 },
    efficiency: { N: 0.50, P2O5: 0.25, K2O: 0.65, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 70, targetpH: 6.0,
    notes: 'Cultivo perenne. Fertilización fraccionada 4-6 veces/año. Alta demanda de K.'
  },

  // ==================== PALTA (AGUACATE) ====================
  palta: {
    id: 'palta', name: 'Palta / Aguacate', scientific: 'Persea americana',
    yieldUnit: 't/ha', yieldRange: [5, 25], defaultYield: 12,
    perennial: true, spacing: '7x7m', plantsPerHa: 204,
    yieldProfiles: [
      { label: 'Bajo (<8 t/ha)',      range: [5, 8],   extractionMult: 0.90, efficiencyMult: 1.10 },
      { label: 'Medio (8-15 t/ha)',   range: [8, 15],  extractionMult: 1.00, efficiencyMult: 1.00 },
      { label: 'Alto (15-20 t/ha)',   range: [15, 20], extractionMult: 1.10, efficiencyMult: 0.92 },
      { label: 'Muy alto (>20 t/ha)', range: [20, 25], extractionMult: 1.18, efficiencyMult: 0.85 }
    ],
    soil: {
      pH_H2O:  { mb: [0,5.0], b: [5.0,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
      MO:      { mb: [0,15], b: [15,25], m: [25,40], a: [40,60], ma: [60,999] },
      P:       { mb: [0,8], b: [8,15], m: [15,30], a: [30,50], ma: [50,999] },
      K:       { mb: [0,1.5], b: [1.5,3.0], m: [3.0,5.0], a: [5.0,8.0], ma: [8.0,99] },
      Ca:      { mb: [0,10], b: [10,20], m: [20,40], a: [40,60], ma: [60,999] },
      Mg:      { mb: [0,5], b: [5,10], m: [10,18], a: [18,30], ma: [30,999] },
      S:       { mb: [0,5], b: [5,10], m: [10,15], a: [15,20], ma: [20,999] },
      B:       { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] },
      Cu:      { mb: [0,0.5], b: [0.5,0.8], m: [0.8,1.5], a: [1.5,3.0], ma: [3.0,99] },
      Fe:      { mb: [0,8], b: [8,15], m: [15,35], a: [35,60], ma: [60,999] },
      Mn:      { mb: [0,2], b: [2,6], m: [6,12], a: [12,25], ma: [25,999] },
      Zn:      { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      V:       { mb: [0,40], b: [40,55], m: [55,70], a: [70,85], ma: [85,100] },
      CTC:     { mb: [0,30], b: [30,60], m: [60,100], a: [100,200], ma: [200,999] },
      Al:      { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,15], muyAlto: [15,999] }
    },
    leaf: { // Hojas de ramos sin frutos, 5-7 meses
      N: { def: [0,16], b: [16,20], ad: [20,25], a: [25,30], ex: [30,99] },
      P: { def: [0,0.8], b: [0.8,1.0], ad: [1.0,2.5], a: [2.5,3.5], ex: [3.5,99] },
      K: { def: [0,5], b: [5,8], ad: [8,20], a: [20,30], ex: [30,99] },
      Ca: { def: [0,5], b: [5,10], ad: [10,30], a: [30,50], ex: [50,99] },
      Mg: { def: [0,2], b: [2,3], ad: [3,8], a: [8,15], ex: [15,99] },
      S: { def: [0,1.5], b: [1.5,2.0], ad: [2.0,5.0], a: [5.0,8.0], ex: [8.0,99] },
      B: { def: [0,20], b: [20,30], ad: [30,80], a: [80,120], ex: [120,999] },
      Cu: { def: [0,3], b: [3,5], ad: [5,15], a: [15,25], ex: [25,999] },
      Fe: { def: [0,40], b: [40,60], ad: [60,200], a: [200,400], ex: [400,9999] },
      Mn: { def: [0,20], b: [20,30], ad: [30,150], a: [150,300], ex: [300,9999] },
      Zn: { def: [0,15], b: [15,20], ad: [20,50], a: [50,100], ex: [100,999] }
    },
    extraction: { N: 8.0, P2O5: 3.0, K2O: 12.0, Ca: 2.0, Mg: 1.5, S: 1.0, B: 0.008, Cu: 0.003, Fe: 0.04, Mn: 0.006, Zn: 0.005 },
    exportt:    { N: 2.5, P2O5: 1.0, K2O: 5.0, Ca: 0.2, Mg: 0.3, S: 0.3 },
    efficiency: { N: 0.45, P2O5: 0.25, K2O: 0.60, Ca: 0.50, Mg: 0.50, S: 0.50 },
    targetV: 70, targetpH: 6.0,
    notes: 'Perenne. Muy sensible a Phytophthora. Requiere buen drenaje. Sensible a exceso de Cl.'
  }
};

// ==================== NUTRIENT RELATIONSHIPS ====================
const NUTRIENT_RELATIONSHIPS = {
  'Ca/Mg': { optimal: [3, 5], low: 'Exceso relativo de Mg, posible deficiencia inducida de Ca', high: 'Exceso relativo de Ca, posible deficiencia inducida de Mg' },
  'Ca/K':  { optimal: [12, 20], low: 'Exceso relativo de K, posible deficiencia inducida de Ca', high: 'Exceso relativo de Ca, puede afectar absorción de K' },
  'Mg/K':  { optimal: [3, 6], low: 'Exceso relativo de K, posible deficiencia inducida de Mg', high: 'Exceso relativo de Mg, puede limitar absorción de K' },
  '(Ca+Mg)/K': { optimal: [25, 45], low: 'Posible toxicidad de K o deficiencia de Ca+Mg', high: 'Posible deficiencia de K por antagonismo' },
  'Ca/CTC':    { optimal: [50, 70], low: 'Ca ocupa poco porcentaje de la CTC', high: 'Ca en exceso en la CTC (normal en Vertisoles)' },
  'Mg/CTC':    { optimal: [10, 20], low: 'Mg ocupa poco porcentaje de la CTC', high: 'Exceso de Mg en la CTC, puede afectar estructura' },
  'K/CTC':     { optimal: [2, 5], low: 'K insuficiente en la CTC', high: 'Exceso de K puede desplazar Ca y Mg' },
  'Fe/Mn':     { optimal: [1.5, 5], low: 'Posible toxicidad de Mn o deficiencia de Fe', high: 'Posible deficiencia de Mn inducida por Fe' },
  'P/Zn':      { optimal: [null, 300], low: null, high: 'Exceso de P puede inducir deficiencia de Zn' },
  'Cu/Zn':     { optimal: [0.5, 2], low: 'Posible toxicidad de Zn o deficiencia de Cu', high: 'Posible toxicidad de Cu o deficiencia de Zn' }
};

// ==================== TEXTURE CLASSIFICATION ====================
const TEXTURE_CLASSES = {
  classify(sand, silt, clay) {
    if (clay >= 60) return { class: 'Muy arcilloso', group: 4 };
    if (clay >= 35) return { class: 'Arcilloso', group: 3 };
    if (clay >= 25 && silt >= 25) return { class: 'Franco arcilloso', group: 3 };
    if (clay >= 20 && sand <= 50) return { class: 'Franco', group: 2 };
    if (sand >= 70 && clay <= 15) return { class: 'Arenoso', group: 1 };
    if (sand >= 50 && clay <= 20) return { class: 'Franco arenoso', group: 1 };
    if (silt >= 50 && clay <= 25) return { class: 'Franco limoso', group: 2 };
    if (silt >= 80) return { class: 'Limoso', group: 2 };
    return { class: 'Franco', group: 2 };
  }
};

// ==================== FERTILIZER SOURCES ====================
const FERTILIZER_SOURCES = {
  // Nitrógeno
  urea:          { name: 'Urea', N: 46, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0, formula: 'CO(NH₂)₂' },
  sulfatoAmonio: { name: 'Sulfato de amonio', N: 21, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 24, formula: '(NH₄)₂SO₄' },
  nitrato:       { name: 'Nitrato de amonio', N: 33, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0, formula: 'NH₄NO₃' },
  // Fósforo
  sft:           { name: 'Superfosfato triple', N: 0, P2O5: 46, K2O: 0, Ca: 13, Mg: 0, S: 0, formula: 'Ca(H₂PO₄)₂' },
  sfs:           { name: 'Superfosfato simple', N: 0, P2O5: 18, K2O: 0, Ca: 20, Mg: 0, S: 12, formula: '' },
  map:           { name: 'MAP', N: 11, P2O5: 52, K2O: 0, Ca: 0, Mg: 0, S: 0, formula: 'NH₄H₂PO₄' },
  dap:           { name: 'DAP', N: 18, P2O5: 46, K2O: 0, Ca: 0, Mg: 0, S: 0, formula: '(NH₄)₂HPO₄' },
  // Potasio
  kcl:           { name: 'Cloruro de potasio', N: 0, P2O5: 0, K2O: 60, Ca: 0, Mg: 0, S: 0, formula: 'KCl' },
  k2so4:         { name: 'Sulfato de potasio', N: 0, P2O5: 0, K2O: 50, Ca: 0, Mg: 0, S: 18, formula: 'K₂SO₄' },
  // NPK
  npk_04_20_20:  { name: 'NPK 04-20-20', N: 4, P2O5: 20, K2O: 20, Ca: 0, Mg: 0, S: 0 },
  npk_10_20_20:  { name: 'NPK 10-20-20', N: 10, P2O5: 20, K2O: 20, Ca: 0, Mg: 0, S: 0 },
  npk_20_10_10:  { name: 'NPK 20-10-10', N: 20, P2O5: 10, K2O: 10, Ca: 0, Mg: 0, S: 0 },
  // Enmiendas
  calDolomita:   { name: 'Cal dolomítica', N: 0, P2O5: 0, K2O: 0, Ca: 28, Mg: 12, S: 0, PRNT: 80, type: 'amendment' },
  calCalcitica:  { name: 'Cal calcítica', N: 0, P2O5: 0, K2O: 0, Ca: 38, Mg: 2, S: 0, PRNT: 85, type: 'amendment' },
  yeso:          { name: 'Yeso agrícola', N: 0, P2O5: 0, K2O: 0, Ca: 17, Mg: 0, S: 15, type: 'amendment' },
  // Micronutrientes
  acidoBorico:   { name: 'Ácido bórico', B: 17 },
  borax:         { name: 'Bórax', B: 11 },
  sulfatoZn:     { name: 'Sulfato de zinc', Zn: 22, S: 11 },
  sulfatoCu:     { name: 'Sulfato de cobre', Cu: 25, S: 13 },
  sulfatoMn:     { name: 'Sulfato de manganeso', Mn: 26, S: 14 },
  sulfatoFe:     { name: 'Sulfato ferroso', Fe: 19, S: 11 },
  fteComp:       { name: 'FTE BR-12 (mix micros)', B: 1.8, Cu: 0.8, Fe: 3.0, Mn: 2.0, Mo: 0.1, Zn: 9.0 }
};

// Classification labels
const CLASS_LABELS = {
  mb: 'Muy bajo', b: 'Bajo', m: 'Medio', a: 'Alto', ma: 'Muy alto',
  def: 'Deficiente', ad: 'Adecuado', ex: 'Excesivo',
  nulo: 'Nulo', bajo: 'Bajo', medio: 'Medio', alto: 'Alto', muyAlto: 'Muy alto'
};

const CLASS_COLORS = {
  mb: '#ef4444', b: '#f97316', m: '#eab308', a: '#22c55e', ma: '#3b82f6',
  def: '#ef4444', ad: '#22c55e', ex: '#3b82f6',
  nulo: '#22c55e', bajo: '#a3e635', medio: '#eab308', alto: '#f97316', muyAlto: '#ef4444'
};

// Nutrient display info — units updated dynamically by unit system
const NUTRIENT_INFO = {
  pH_H2O: { label: 'pH (H₂O)', unit: '', decimals: 1 },
  MO:     { label: 'Materia Orgánica', unit: 'g/dm³', decimals: 1 },
  P:      { label: 'Fósforo (P)', unit: 'mg/dm³', decimals: 1 },
  K:      { label: 'Potasio (K⁺)', unit: 'mmolc/dm³', decimals: 2 },
  Ca:     { label: 'Calcio (Ca²⁺)', unit: 'mmolc/dm³', decimals: 1 },
  Mg:     { label: 'Magnesio (Mg²⁺)', unit: 'mmolc/dm³', decimals: 1 },
  Al:     { label: 'Aluminio (Al³⁺)', unit: 'mmolc/dm³', decimals: 1 },
  S:      { label: 'Azufre (S-SO₄)', unit: 'mg/dm³', decimals: 1 },
  B:      { label: 'Boro (B)', unit: 'mg/dm³', decimals: 2 },
  Cu:     { label: 'Cobre (Cu)', unit: 'mg/dm³', decimals: 2 },
  Fe:     { label: 'Hierro (Fe)', unit: 'mg/dm³', decimals: 1 },
  Mn:     { label: 'Manganeso (Mn)', unit: 'mg/dm³', decimals: 1 },
  Zn:     { label: 'Zinc (Zn)', unit: 'mg/dm³', decimals: 2 },
  V:      { label: 'Saturación bases (V%)', unit: '%', decimals: 1 },
  CTC:    { label: 'CTC', unit: 'mmolc/dm³', decimals: 1 },
  H_Al:   { label: 'H+Al', unit: 'mmolc/dm³', decimals: 1 },
  SB:     { label: 'Suma de bases', unit: 'mmolc/dm³', decimals: 1 },
  m:      { label: 'Saturación Al (m%)', unit: '%', decimals: 1 },
  sand:   { label: 'Arena', unit: '%', decimals: 0 },
  silt:   { label: 'Limo', unit: '%', decimals: 0 },
  clay:   { label: 'Arcilla', unit: '%', decimals: 0 }
};

// ==================== RANGES BY EXTRACTION METHOD ====================
// Interpretation varies by extraction method, texture class, and crop type
// References: Raij et al. (1997) Bol. Téc. 100 IAC, EMBRAPA (2004),
//   Mehlich-3: Bortolon & Gianello (2008), CQFS-RS/SC (2016)

const P_METHODS = {
  mehlich1: {
    name: 'Mehlich 1',
    description: 'Doble ácido (H₂SO₄ + HCl). Estándar Brasil excepto São Paulo.',
    byTexture: {
      1: { mb: [0,3],  b: [3,6],   m: [6,12],  a: [12,18], ma: [18,999] },
      2: { mb: [0,5],  b: [5,10],  m: [10,15], a: [15,25], ma: [25,999] },
      3: { mb: [0,6],  b: [6,12],  m: [12,20], a: [20,40], ma: [40,999] },
      4: { mb: [0,8],  b: [8,15],  m: [15,25], a: [25,50], ma: [50,999] }
    }
  },
  mehlich3: {
    name: 'Mehlich 3',
    description: 'Extractor universal (Mehlich, 1984). Correlación amplia.',
    byTexture: {
      1: { mb: [0,8],   b: [8,15],  m: [15,25],  a: [25,40],  ma: [40,999] },
      2: { mb: [0,12],  b: [12,20], m: [20,30],  a: [30,50],  ma: [50,999] },
      3: { mb: [0,15],  b: [15,25], m: [25,40],  a: [40,60],  ma: [60,999] },
      4: { mb: [0,18],  b: [18,30], m: [30,50],  a: [50,80],  ma: [80,999] }
    }
  },
  resina: {
    name: 'Resina',
    description: 'Resina de intercambio iónico (IAC/Raij). Estándar São Paulo.',
    byCropType: {
      anuales:    { mb: [0,6],  b: [6,15],  m: [15,40],  a: [40,80],  ma: [80,999] },
      hortalizas: { mb: [0,10], b: [10,25], m: [25,60],  a: [60,120], ma: [120,999] },
      perennes:   { mb: [0,6],  b: [6,12],  m: [12,30],  a: [30,60],  ma: [60,999] }
    }
  }
};

// Map each crop to its Resina crop type
const CROP_P_TYPE = {
  cana: 'anuales', soja: 'anuales', maiz: 'anuales', sorgo: 'anuales',
  girasol: 'anuales', chia: 'anuales',
  tomate: 'hortalizas', pimenton: 'hortalizas', papa: 'hortalizas',
  maracuya: 'perennes', palta: 'perennes'
};

// ==================== METHOD-SPECIFIC RANGES FOR ALL NUTRIENTS ====================
// When a lab method is selected, these ranges OVERRIDE the crop-default ranges
// for the nutrients listed here. Nutrients not listed fall back to crop defaults.
// Reference: Raij et al. (1997) Bol. Téc. 100, CQFS-RS/SC (2016)

const METHOD_RANGES = {

  // ---- RESINA / IAC (Raij et al. 1997 — Boletim Técnico 100) ----
  resina: {
    // K by resina — mmolc/dm³ (same unit, different calibration)
    K: {
      default:    { mb: [0,0.7], b: [0.7,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] },
      hortalizas: { mb: [0,1.5], b: [1.5,3.0], m: [3.0,6.0], a: [6.0,10],  ma: [10,99] }
    },
    // Ca by resina — mmolc/dm³
    Ca: {
      default:    { mb: [0,3],  b: [3,7],   m: [7,15],  a: [15,40],  ma: [40,999] },
      hortalizas: { mb: [0,5],  b: [5,10],  m: [10,20], a: [20,50],  ma: [50,999] }
    },
    // Mg by resina — mmolc/dm³
    Mg: {
      default:    { mb: [0,2],  b: [2,5],  m: [5,9],  a: [9,20],  ma: [20,999] },
      hortalizas: { mb: [0,3],  b: [3,6],  m: [6,12], a: [12,25], ma: [25,999] }
    },
    // S-SO4 (extracción Ca(H₂PO₄)₂) — mg/dm³
    S: {
      default:    { mb: [0,4],  b: [4,7],  m: [7,10], a: [10,15], ma: [15,999] }
    },
    // B (agua caliente) — mg/dm³
    B: {
      default:    { mb: [0,0.20], b: [0.20,0.40], m: [0.40,0.60], a: [0.60,1.0], ma: [1.0,99] }
    },
    // Cu (DTPA) — mg/dm³
    Cu: {
      default:    { mb: [0,0.2], b: [0.2,0.4], m: [0.4,0.8], a: [0.8,1.5], ma: [1.5,99] }
    },
    // Fe (DTPA) — mg/dm³
    Fe: {
      default:    { mb: [0,4],  b: [4,12],  m: [12,30], a: [30,60], ma: [60,999] }
    },
    // Mn (DTPA) — mg/dm³
    Mn: {
      default:    { mb: [0,1.2], b: [1.2,5], m: [5,12], a: [12,25], ma: [25,999] }
    },
    // Zn (DTPA) — mg/dm³
    Zn: {
      default:    { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.0], a: [2.0,5.0], ma: [5.0,99] }
    },
    // MO — g/dm³
    MO: {
      default:    { mb: [0,7],  b: [7,15],  m: [15,25], a: [25,40], ma: [40,999] }
    },
    // V% (igual para todos los métodos, pero IAC tiene rangos calibrados)
    V: {
      anuales:    { mb: [0,25], b: [25,40], m: [40,60], a: [60,80], ma: [80,100] },
      hortalizas: { mb: [0,30], b: [30,50], m: [50,70], a: [70,85], ma: [85,100] },
      perennes:   { mb: [0,30], b: [30,45], m: [45,65], a: [65,80], ma: [80,100] }
    },
    // CTC — mmolc/dm³
    CTC: {
      default:    { mb: [0,25], b: [25,50], m: [50,80], a: [80,150], ma: [150,999] }
    },
    // Al — mmolc/dm³ (KCl extraction, same for all methods)
    Al: {
      default:    { nulo: [0,2], bajo: [2,5], medio: [5,10], alto: [10,20], muyAlto: [20,999] }
    },
  },

  // ---- MEHLICH 3 (CQFS-RS/SC 2016, Bortolon & Gianello 2008) ----
  mehlich3: {
    // K by Mehlich 3 — varies by CTC class
    K: {
      // CTC ≤ 5 cmolc/dm³
      ctcBaja:    { mb: [0,20],  b: [20,40],  m: [40,60],  a: [60,120],  ma: [120,999] }, // mg/dm³
      // CTC 5.1-15
      ctcMedia:   { mb: [0,30],  b: [30,60],  m: [60,90],  a: [90,180],  ma: [180,999] },
      // CTC > 15
      ctcAlta:    { mb: [0,45],  b: [45,90],  m: [90,135], a: [135,270], ma: [270,999] },
      // Standard mmolc/dm³ (converted: mg/dm³ ÷ 39.1)
      default:    { mb: [0,0.8], b: [0.8,1.5], m: [1.5,3.0], a: [3.0,6.0], ma: [6.0,99] }
    },
    // Ca by Mehlich 3 — mmolc/dm³
    Ca: {
      default:    { mb: [0,4],  b: [4,10],  m: [10,20], a: [20,40], ma: [40,999] }
    },
    // Mg by Mehlich 3 — mmolc/dm³
    Mg: {
      default:    { mb: [0,2],  b: [2,5],  m: [5,10], a: [10,20], ma: [20,999] }
    },
    // S by Mehlich 3 — mg/dm³
    S: {
      default:    { mb: [0,5],  b: [5,10], m: [10,15], a: [15,20], ma: [20,999] }
    },
    // B by Mehlich 3 — mg/dm³ (extrae más que agua caliente)
    B: {
      default:    { mb: [0,0.3], b: [0.3,0.5], m: [0.5,0.8], a: [0.8,1.5], ma: [1.5,99] }
    },
    // Cu by Mehlich 3 — mg/dm³
    Cu: {
      default:    { mb: [0,0.3], b: [0.3,0.5], m: [0.5,1.0], a: [1.0,2.0], ma: [2.0,99] }
    },
    // Mn by Mehlich 3 — mg/dm³ (extrae más que DTPA)
    Mn: {
      default:    { mb: [0,2], b: [2,6], m: [6,15], a: [15,30], ma: [30,999] }
    },
    // Zn by Mehlich 3 — mg/dm³
    Zn: {
      default:    { mb: [0,0.5], b: [0.5,1.0], m: [1.0,2.5], a: [2.5,5.0], ma: [5.0,99] }
    }
  }
  // mehlich1: uses crop-default ranges (most crops are already calibrated for M1)
};

// ==================== pH RANGES BY DETERMINATION METHOD ====================
// pH en Agua (H₂O): estándar EMBRAPA, INTA, CIAT. Valores ~0.5 unidades más altos que CaCl₂
// pH en CaCl₂ (0.01M): estándar IAC/São Paulo (Raij 1997), más estable y reproducible
// Reference: EMBRAPA (2018), Raij et al. (1997), CQFS-RS/SC (2016)

const PH_RANGES = {
  // pH en Agua (H₂O) — rangos generales (usados por crop defaults)
  agua: {
    anuales:    { mb: [0,4.5], b: [4.5,5.0], m: [5.0,5.5], a: [5.5,6.0], ma: [6.0,14] },
    hortalizas: { mb: [0,4.5], b: [4.5,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] },
    perennes:   { mb: [0,4.5], b: [4.5,5.5], m: [5.5,6.0], a: [6.0,6.5], ma: [6.5,14] }
  },
  // pH en CaCl₂ (0.01M) — rangos IAC (Raij 1997)
  // Generalmente 0.3-0.6 unidades por debajo de pH H₂O
  cacl2: {
    anuales:    { mb: [0,4.3], b: [4.3,5.0], m: [5.0,5.5], a: [5.5,6.0], ma: [6.0,14] },
    hortalizas: { mb: [0,4.3], b: [4.3,5.0], m: [5.0,5.5], a: [5.5,6.0], ma: [6.0,14] },
    perennes:   { mb: [0,4.3], b: [4.3,5.0], m: [5.0,5.5], a: [5.5,6.0], ma: [6.0,14] }
  }
};

// ==================== UNIT CONVERSION SYSTEM ====================
// All internal ranges are in mmolc/dm³ for cations, g/dm³ for MO, % for texture
// The conversion system normalizes input to internal units before classification

const UNIT_SYSTEMS = {
  // Cation units: K, Ca, Mg, Al, H+Al, CTC, SB
  cations: {
    'mmolc/dm³': { factor: 1, label: 'mmolc/dm³' },       // Internal standard
    'cmolc/dm³': { factor: 10, label: 'cmolc/dm³' },      // 1 cmolc = 10 mmolc
    'meq/100g':  { factor: 10, label: 'meq/100g' },       // 1 meq/100g ≈ 1 cmolc = 10 mmolc
    'meq/100cm³': { factor: 10, label: 'meq/100cm³' },
    'mg/dm³_K':  { factor: 1/39.1, label: 'mg/dm³ (K)' }, // mg K → mmolc (÷39.1)
    'mg/dm³_Ca': { factor: 1/20.0, label: 'mg/dm³ (Ca)' },
    'mg/dm³_Mg': { factor: 1/12.15, label: 'mg/dm³ (Mg)' },
    'ppm_K':     { factor: 1/39.1, label: 'ppm (K)' }
  },
  // MO units
  mo: {
    'g/dm³': { factor: 1, label: 'g/dm³' },
    'g/kg':  { factor: 1, label: 'g/kg' },        // g/dm³ ≈ g/kg for soils
    'dag/kg': { factor: 10, label: 'dag/kg (%)' }, // 1 dag/kg = 10 g/kg
    '%':     { factor: 10, label: '%' }             // 1% = 10 g/dm³
  },
  // Texture units
  texture: {
    '%':    { factor: 1, label: '%' },
    'g/kg': { factor: 0.1, label: 'g/kg' }  // 1 g/kg = 0.1%
  },
  // P, S, micronutrients (mg/dm³ = mg/kg = ppm)
  extractable: {
    'mg/dm³': { factor: 1, label: 'mg/dm³' },
    'mg/kg':  { factor: 1, label: 'mg/kg' },
    'ppm':    { factor: 1, label: 'ppm' },
    'mg/L':   { factor: 1, label: 'mg/L' }
  }
};

// Which unit group each soil parameter belongs to
const PARAM_UNIT_GROUP = {
  pH_H2O: null, // dimensionless
  MO: 'mo',
  P: 'extractable', S: 'extractable',
  K: 'cations', Ca: 'cations', Mg: 'cations', Al: 'cations',
  H_Al: 'cations', SB: 'cations', CTC: 'cations',
  V: null, // %
  B: 'extractable', Cu: 'extractable', Fe: 'extractable',
  Mn: 'extractable', Zn: 'extractable',
  sand: 'texture', silt: 'texture', clay: 'texture'
};

// ==================== DRIS NORMS ====================
// DRIS_NORMS and DRIS_NUTRIENTS are loaded asynchronously from:
//   data/ibra-norms.json
// Use InterpretationEngine.loadNorms() before calling calculateDRIS() or calculateCND().
// The engine falls back gracefully if norms are not yet loaded.

// ==================== NUTRIENT RELATIONSHIP SUFFICIENCY RANGES BY CROP ====================
// Extended relationship ranges per crop (overrides generic NUTRIENT_RELATIONSHIPS when available)
const CROP_RELATIONSHIP_RANGES = {
  cana: {
    'Ca/Mg': { optimal: [3, 5], low: 'Exceso Mg relativo → antagonismo Ca', high: 'Exceso Ca relativo → limitar absorción Mg' },
    'Ca/K':  { optimal: [10, 15], low: 'K elevado puede inhibir Ca', high: 'Bajo K relativo' },
    'Mg/K':  { optimal: [3, 5], low: 'K elevado inhibe Mg', high: 'Mg en exceso, revisar K' },
    '(Ca+Mg)/K': { optimal: [20, 40], low: 'K dominante, riesgo lujoso', high: 'K insuficiente' },
    'Ca/CTC': { optimal: [50, 65], low: 'Ca insuficiente en CTC', high: 'Normal' },
    'Mg/CTC': { optimal: [10, 20], low: 'Mg insuficiente en CTC', high: 'Mg excesivo en CTC' },
    'K/CTC':  { optimal: [3, 5], low: 'K muy bajo en CTC', high: 'K lujoso en CTC' }
  },
  soja: {
    'Ca/Mg': { optimal: [3, 5], low: 'Exceso Mg → limita Ca', high: 'Exceso Ca → limita Mg' },
    'Ca/K':  { optimal: [15, 25], low: 'K elevado inhibe Ca', high: 'K deficiente relativo' },
    'Mg/K':  { optimal: [4, 8], low: 'K elevado inhibe Mg', high: 'Mg dominante' },
    '(Ca+Mg)/K': { optimal: [25, 45], low: 'K dominante', high: 'K insuficiente' },
    'Ca/CTC': { optimal: [50, 70], low: 'Ca insuficiente', high: 'Normal' },
    'Mg/CTC': { optimal: [10, 20], low: 'Mg insuficiente', high: 'Mg excesivo' },
    'K/CTC':  { optimal: [2, 5], low: 'K muy bajo', high: 'K excesivo' }
  },
  maiz: {
    'Ca/Mg': { optimal: [3, 5], low: 'Mg excesivo relativo', high: 'Ca excesivo relativo' },
    'Ca/K':  { optimal: [12, 20], low: 'K elevado', high: 'K deficiente relativo' },
    'Mg/K':  { optimal: [3, 6], low: 'K inhibe Mg', high: 'Mg excesivo' },
    '(Ca+Mg)/K': { optimal: [25, 40], low: 'K dominante', high: 'K insuficiente' },
    'Ca/CTC': { optimal: [50, 65], low: 'Ca bajo en CTC', high: 'Normal' },
    'Mg/CTC': { optimal: [10, 20], low: 'Mg bajo en CTC', high: 'Mg excesivo' },
    'K/CTC':  { optimal: [3, 5], low: 'K bajo', high: 'K excesivo' }
  },
  tomate: {
    'Ca/Mg': { optimal: [3, 5], low: 'Mg excesivo → riesgo BER', high: 'Ca adecuado' },
    'Ca/K':  { optimal: [8, 15], low: 'K alto → riesgo BER', high: 'K insuficiente' },
    'Mg/K':  { optimal: [2, 4], low: 'K inhibe Mg', high: 'Mg excesivo' },
    '(Ca+Mg)/K': { optimal: [20, 35], low: 'K dominante', high: 'K insuficiente' },
    'Ca/CTC': { optimal: [55, 70], low: 'Ca insuficiente para hortalizas', high: 'Normal' },
    'Mg/CTC': { optimal: [10, 20], low: 'Mg insuficiente', high: 'Mg excesivo' },
    'K/CTC':  { optimal: [3, 6], low: 'K bajo', high: 'K excesivo' }
  }
  // Other crops fall back to generic NUTRIENT_RELATIONSHIPS
};
