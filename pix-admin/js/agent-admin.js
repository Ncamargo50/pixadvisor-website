// ============================================================
// PIX Admin Agent — Agente IA especializado en Agricultura de Precisión
// Automatización, monitoreo de errores, chat/voz, IBRA CSV parser
// ============================================================

class PixAdminAgent {
  constructor() {
    this.name = 'PIX Agent';
    this.version = '1.0.0';
    this.isOpen = false;
    this.isListening = false;
    this.isSpeaking = false;
    this.messages = [];
    this.errorLog = [];
    this.automations = [];
    this.recognition = null;
    this.synthesis = window.speechSynthesis || null;
    this.voiceEnabled = true;
    this.emailCheckInterval = null;

    // Specialized knowledge domains
    this.domains = [
      'análisis de suelo', 'análisis foliar', 'zonas de manejo',
      'interpolación IDW/Kriging', 'prescripción VRT', 'muestreo',
      'DRIS/IBN', 'encalado y yeso', 'fertilización', 'planialtimetría',
      'IBRA megalab', 'CSV laboratorio', 'GIS agricultura'
    ];

    // IBRA lab column mappings
    this.ibraColumnMap = {
      // pH
      'ph': 'pH', 'ph_h2o': 'pH', 'ph_agua': 'pH', 'ph_cacl2': 'pH_CaCl2',
      'ph cacl2': 'pH_CaCl2', 'ph em cacl2': 'pH_CaCl2', 'ph em agua': 'pH',
      // MO
      'mo': 'MO', 'm.o.': 'MO', 'm.o': 'MO', 'materia organica': 'MO',
      'mat. org.': 'MO', 'matéria orgânica': 'MO', 'c.org': 'C_org',
      // P
      'p': 'P', 'p_mehlich': 'P', 'p mehlich': 'P', 'p resina': 'P_resina',
      'p (mehlich)': 'P', 'p (resina)': 'P_resina', 'fosforo': 'P', 'fósforo': 'P',
      // K
      'k': 'K', 'potasio': 'K', 'potássio': 'K', 'k+': 'K',
      // Ca
      'ca': 'Ca', 'calcio': 'Ca', 'cálcio': 'Ca', 'ca2+': 'Ca', 'ca++': 'Ca',
      // Mg
      'mg': 'Mg', 'magnesio': 'Mg', 'magnésio': 'Mg', 'mg2+': 'Mg', 'mg++': 'Mg',
      // Al
      'al': 'Al', 'aluminio': 'Al', 'alumínio': 'Al', 'al3+': 'Al', 'al+++': 'Al',
      // H+Al
      'h+al': 'H_Al', 'h + al': 'H_Al', 'acidez potencial': 'H_Al',
      'acidez pot.': 'H_Al', 'hal': 'H_Al',
      // S
      's': 'S', 's-so4': 'S', 'enxofre': 'S', 'azufre': 'S', 'so4': 'S',
      // B
      'b': 'B', 'boro': 'B',
      // Cu
      'cu': 'Cu', 'cobre': 'Cu',
      // Fe
      'fe': 'Fe', 'hierro': 'Fe', 'ferro': 'Fe',
      // Mn
      'mn': 'Mn', 'manganeso': 'Mn', 'manganês': 'Mn',
      // Zn
      'zn': 'Zn', 'zinc': 'Zn', 'zinco': 'Zn',
      // Na
      'na': 'Na', 'sodio': 'Na', 'sódio': 'Na',
      // CTC
      'ctc': 'CTC', 'ctc (t)': 'CTC_t', 'ctc_t': 'CTC_t', 'ctc t': 'CTC_t',
      'ctc (ph7)': 'CTC', 'ctc a ph7': 'CTC', 'ctc ph 7': 'CTC', 't': 'CTC_t',
      // SB
      'sb': 'SB', 'soma de bases': 'SB', 'sum bases': 'SB', 'soma bases': 'SB',
      // V%
      'v%': 'V', 'v (%)': 'V', 'sat. bases': 'V', 'saturação por bases': 'V',
      'saturacion bases': 'V', 'v': 'V',
      // m%
      'm%': 'm_Al', 'm (%)': 'm_Al', 'sat. al': 'm_Al', 'saturação al': 'm_Al',
      // Texture
      'argila': 'arcilla', 'arcilla': 'arcilla', 'clay': 'arcilla',
      'areia': 'arena', 'arena': 'arena', 'sand': 'arena',
      'silte': 'limo', 'limo': 'limo', 'silt': 'limo',
      // Sample ID
      'amostra': 'sampleId', 'muestra': 'sampleId', 'id': 'sampleId',
      'identificação': 'sampleId', 'identificacion': 'sampleId', 'cod': 'sampleId',
      'código': 'sampleId', 'codigo': 'sampleId', 'sample': 'sampleId',
      'ponto': 'sampleId', 'punto': 'sampleId'
    };

    // Automation recipes
    this._registerAutomations();
  }

  // ===== INITIALIZATION =====

  init() {
    this._buildChatUI();
    this._setupErrorMonitor();
    this._setupSpeechRecognition();
    this._addSystemMessage('PIX Agent activo. Especializado en agricultura de precisión. ¿En qué puedo ayudarte?');
    this._addSystemMessage('Puedo: importar CSV de IBRA, auto-rellenar análisis, generar reportes, monitorear errores, y más.');
    console.log('[PIX Agent] Admin agent initialized');
  }

  // ===== CHAT UI =====

  _buildChatUI() {
    // Floating button
    const fab = document.createElement('div');
    fab.id = 'agentFab';
    fab.className = 'agent-fab';
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
        <path d="M9 21h6M10 17v4M14 17v4"/>
      </svg>
      <span class="agent-fab-badge" id="agentBadge" style="display:none">0</span>
    `;
    fab.onclick = () => this.toggle();

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'agentPanel';
    panel.className = 'agent-panel';
    panel.innerHTML = `
      <div class="agent-header">
        <div class="agent-header-info">
          <div class="agent-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
            </svg>
          </div>
          <div>
            <div class="agent-name">PIX Agent</div>
            <div class="agent-status"><span class="agent-status-dot"></span>Activo — Ag. Precisión</div>
          </div>
        </div>
        <div class="agent-header-actions">
          <button class="agent-btn-icon" onclick="pixAgent.showAutomations()" title="Automatizaciones">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button class="agent-btn-icon" onclick="pixAgent.clearChat()" title="Limpiar chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button class="agent-btn-icon" onclick="pixAgent.toggle()" title="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="agent-messages" id="agentMessages"></div>
      <div class="agent-quick-actions" id="agentQuickActions">
        <button class="agent-quick-btn" onclick="pixAgent.handleCommand('/importar-ibra')">Importar IBRA</button>
        <button class="agent-quick-btn" onclick="pixAgent._skillInterpretacionSuelos('')">Suelos</button>
        <button class="agent-quick-btn" onclick="pixAgent._skillFertilizacion('')">Fertilización</button>
        <button class="agent-quick-btn" onclick="pixAgent._skillZonasManejo('')">Zonas Manejo</button>
        <button class="agent-quick-btn" onclick="pixAgent._skillBiocontrol('')">Biocontrol</button>
        <button class="agent-quick-btn" onclick="pixAgent._skillBiotechMicrobianos('')">PGPR/Biotech</button>
        <button class="agent-quick-btn" onclick="pixAgent.handleCommand('/estado')">Estado</button>
        <button class="agent-quick-btn" onclick="pixAgent.handleCommand('/ayuda')">Todos los skills</button>
      </div>
      <div class="agent-input-area">
        <button class="agent-voice-btn ${this.isListening ? 'listening' : ''}" id="agentVoiceBtn" onclick="pixAgent.toggleVoice()" title="Hablar con el agente">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        <input type="text" class="agent-input" id="agentInput" placeholder="Preguntá al agente..." onkeydown="if(event.key==='Enter')pixAgent.sendMessage()">
        <button class="agent-send-btn" onclick="pixAgent.sendMessage()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  toggle() {
    this.isOpen = !this.isOpen;
    const panel = document.getElementById('agentPanel');
    const fab = document.getElementById('agentFab');
    if (this.isOpen) {
      panel.classList.add('open');
      fab.classList.add('active');
      document.getElementById('agentInput').focus();
      // Clear badge
      const badge = document.getElementById('agentBadge');
      if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
    } else {
      panel.classList.remove('open');
      fab.classList.remove('active');
    }
  }

  // ===== MESSAGES =====

  _addMessage(text, sender = 'agent', type = 'text') {
    const msg = { text, sender, type, time: new Date() };
    this.messages.push(msg);
    this._renderMessage(msg);
    // Badge if closed
    if (!this.isOpen && sender === 'agent') {
      const badge = document.getElementById('agentBadge');
      if (badge) {
        const n = parseInt(badge.textContent || '0') + 1;
        badge.textContent = n;
        badge.style.display = '';
      }
    }
  }

  _addSystemMessage(text) {
    this._addMessage(text, 'agent', 'system');
  }

  _renderMessage(msg) {
    const container = document.getElementById('agentMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `agent-msg agent-msg-${msg.sender}`;
    if (msg.type === 'system') div.classList.add('agent-msg-system');

    const time = msg.time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="agent-msg-bubble">${this._formatText(msg.text)}</div>
      <div class="agent-msg-time">${time}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  _formatText(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  clearChat() {
    this.messages = [];
    const container = document.getElementById('agentMessages');
    if (container) container.innerHTML = '';
    this._addSystemMessage('Chat limpiado. ¿En qué puedo ayudarte?');
  }

  // ===== USER INPUT =====

  sendMessage() {
    const input = document.getElementById('agentInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this._addMessage(text, 'user');
    this._processInput(text);
  }

  _processInput(text) {
    const lower = text.toLowerCase().trim();

    // Commands
    if (lower.startsWith('/')) {
      this.handleCommand(lower);
      return;
    }

    // Client data capture mode
    if (this._awaitingClientData && text.includes(':')) {
      if (this._processClientData(text)) return;
    }

    // Automation intents (natural language)
    if (this._matchIntent(lower, ['cargar demo', 'datos demo', 'ejemplo suelo', 'cargar ejemplo'])) {
      this.autoLoadDemoSoil(); return;
    }
    if (this._matchIntent(lower, ['interpretar suelo', 'interpreta el suelo', 'analiza el suelo', 'evaluar suelo'])) {
      this.autoInterpretSoil(); return;
    }
    if (this._matchIntent(lower, ['generar reporte', 'generar informe', 'hacer informe', 'crear reporte', 'hacer reporte'])) {
      this.autoGenerateReport(); return;
    }
    if (this._matchIntent(lower, ['cambiar cultivo', 'seleccionar cultivo', 'cambiar a'])) {
      const crop = lower.replace(/cambiar cultivo|seleccionar cultivo|cambiar a/g, '').trim();
      this.autoSetCrop(crop); return;
    }
    if (this._matchIntent(lower, ['ir a', 'abrir', 'mostrar', 'llevame a', 'navegar a', 'quiero ver'])) {
      const dest = lower.replace(/ir a|abrir|mostrar|llevame a|navegar a|quiero ver/g, '').trim();
      this.autoNavigate(dest); return;
    }
    if (this._matchIntent(lower, ['exportar', 'descargar datos', 'bajar datos'])) {
      this.autoExport(); return;
    }
    if (this._matchIntent(lower, ['validar', 'verificar datos', 'chequear'])) {
      this.autoValidateAll(); return;
    }
    if (this._matchIntent(lower, ['resumen', 'summary', 'resumen ejecutivo'])) {
      this.autoFullSummary(); return;
    }
    if (this._matchIntent(lower, ['workflow', 'flujo completo', 'automatizar todo', 'ejecutar todo', 'hacer todo'])) {
      this.autoWorkflow(); return;
    }
    if (this._matchIntent(lower, ['registrar cliente', 'nuevo cliente', 'cadastro', 'cadastrar', 'agregar cliente', 'cargar cliente'])) {
      this.autoRegisterClient(); return;
    }
    if (this._matchIntent(lower, ['hacienda', 'finca', 'propiedad', 'campo', 'establecimiento'])) {
      this.autoRegisterProperty(); return;
    }
    if (this._matchIntent(lower, ['lote', 'parcela', 'talhao'])) {
      this.autoRegisterLot(); return;
    }

    // Route through skill-based knowledge system
    const handled = this._routeToSkill(lower);
    if (handled) return;

    // Generic fallback
    this._addMessage(this._getSmartResponse(lower), 'agent');
  }

  _matchIntent(text, keywords) {
    return keywords.some(k => text.includes(k));
  }

  // ===== SKILL-BASED KNOWLEDGE ROUTER =====

  _routeToSkill(text) {
    // Each skill is a domain with keywords and response handler
    const skills = [
      // --- Core App Functions ---
      { keys: ['importar', 'ibra', 'csv', 'laboratorio', 'lab'], fn: () => {
        this._addMessage('Abriendo importador de CSV de laboratorio IBRA...', 'agent');
        setTimeout(() => this._triggerIbraImport(), 500);
      }},
      { keys: ['error', 'errores', 'fallo', 'falla', 'bug'], fn: () => this.showErrors() },
      { keys: ['estado', 'status', 'sistema'], fn: () => this.showSystemStatus() },
      { keys: ['ayuda', 'help', 'que puedes', 'que podes', 'comandos'], fn: () => this.showHelp() },
      { keys: ['hola', 'buenos dias', 'buenas', 'hey'], fn: () => {
        this._addMessage('Hola Nilton! Soy PIX Agent, tu asistente de agricultura de precisión con acceso a todos los módulos especializados. ¿En qué puedo ayudarte hoy?', 'agent');
      }},
      { keys: ['email', 'correo', 'gmail', 'mail'], fn: () => {
        this._addMessage('**Monitoreo de Email:**\n- Puedo revisar tu correo `gis.agronomico@gmail.com` para detectar resultados de IBRA\n- También monitoreo `nilton.camargo@pixadvisor.network` para comunicación con clientes\n- Usá `/check-email` para verificar ahora', 'agent');
      }},
      { keys: ['reporte', 'informe', 'report', 'generar informe', 'protocolo', 'pdf', 'documento'], fn: () => this._skillWorkflow(text) },

      // --- SKILL: Interpretación de Suelos ---
      { keys: ['suelo', 'analisis de suelo', 'soil', 'fertilidad'], fn: () => this._skillInterpretacionSuelos(text) },
      { keys: ['ph', 'acidez', 'alcalino', 'alcalinidad'], fn: () => this._skillpH(text) },
      { keys: ['ctc', 'capacidad de intercambio', 'cationes'], fn: () => this._skillCTC(text) },
      { keys: ['saturacion', 'v%', 'bases'], fn: () => this._skillSaturacion(text) },
      { keys: ['materia organica', 'mo ', 'carbono organico', 'humus'], fn: () => this._skillMO(text) },
      { keys: ['salinidad', 'sodio', 'sodicidad', 'ras', 'ce ', 'conductividad'], fn: () => this._skillSalinidad(text) },
      { keys: ['textura', 'arcilla', 'arena', 'limo', 'granulometria'], fn: () => this._skillTextura(text) },
      { keys: ['agua de riego', 'riego', 'calidad de agua'], fn: () => this._skillAguaRiego(text) },

      // --- SKILL: Análisis Foliar & DRIS ---
      { keys: ['foliar', 'hoja', 'leaf', 'dris', 'ibn', 'cnd', 'sufficiency'], fn: () => this._skillFoliar(text) },

      // --- SKILL: Relaciones entre Nutrientes ---
      { keys: ['relacion', 'relaciones', 'ca/mg', 'ca/k', 'mg/k', 'equilibrio', 'balance'], fn: () => this._skillRelaciones(text) },

      // --- SKILL: Recomendación de Fertilización ---
      { keys: ['fertiliza', 'recomendacion', 'dosis', 'npk', 'nutriente', 'extraccion', 'exportacion', 'kg/ha', 'g/planta', 'rendimiento'], fn: () => this._skillFertilizacion(text) },
      { keys: ['encalado', 'cal', 'caliza', 'dolomita', 'prnt', 'yeso', 'enmienda', 'correccion'], fn: () => this._skillEncalado(text) },

      // --- SKILL: Zonas de Manejo & GIS ---
      { keys: ['zona', 'zonas de manejo', 'management zone', 'cluster', 'ambiente', 'ugd'], fn: () => this._skillZonasManejo(text) },
      { keys: ['ndvi', 'ndre', 'evi', 'savi', 'msavi', 'indice vegetacion', 'indice de vegetacion', 'vegetativo'], fn: () => this._skillIndicesVegetacion(text) },
      { keys: ['firma espectral', 'clasificacion cultivo', 'identificar cultivo', 'espectral'], fn: () => this._skillFirmaEspectral(text) },
      { keys: ['maleza', 'malezas', 'weed', 'deteccion maleza', 'falla', 'falla de plantio', 'restitucion'], fn: () => this._skillDeteccionMalezas(text) },

      // --- SKILL: Prescripción VRT ---
      { keys: ['prescripcion', 'vrt', 'tasa variable', 'prescription', 'aplicacion variable'], fn: () => this._skillPrescripcion(text) },

      // --- SKILL: Puntos de Muestreo ---
      { keys: ['muestreo', 'puntos', 'sampling', 'grid', 'grilla'], fn: () => this._skillMuestreo(text) },

      // --- SKILL: DataFarm / IBRA Platform ---
      { keys: ['datafarm', 'data farm', 'ibra megalab', 'lab online', 'colecta', 'talhao', 'talhon', 'yield gap', 'scouting'], fn: () => this._skillDataFarm(text) },

      // --- SKILL: Biocontrol de Plagas ---
      { keys: ['biocontrol', 'biologico', 'plaga', 'enfermedad', 'beauveria', 'metarhizium', 'trichoderma', 'trichogramma', 'bacillus', 'bt', 'mip', 'ipm', 'spodoptera', 'mosca blanca', 'fusarium', 'phytophthora', 'nematodo'], fn: () => this._skillBiocontrol(text) },

      // --- SKILL: Biotech Microbianos ---
      { keys: ['pgpr', 'azospirillum', 'pseudomonas', 'bradyrhizobium', 'bioinoculante', 'consorcio', 'biofertilizante', 'rizobacteria', 'microbiano'], fn: () => this._skillBiotechMicrobianos(text) },

      // --- SKILL: Metabolitos Bioactivos ---
      { keys: ['metabolito', 'lipopeptido', 'surfactina', 'iturina', 'fengicina', 'sideroforo', 'voc', 'acetoina', 'quitinasa', 'glucanasa', 'dapg', 'fenazina', 'destruxina', 'beauvericina'], fn: () => this._skillMetabolitos(text) },

      // --- SKILL: Bioestimulantes ---
      { keys: ['bioestimulante', 'humico', 'fulvico', 'alga', 'extracto alga', 'quitosano', 'aminoacido'], fn: () => this._skillBioestimulantes(text) },

      // --- SKILL: Contratos Agrícolas ---
      { keys: ['contrato', 'arrendamiento', 'aparceria', 'forward', 'fideicomiso', 'leasing', 'seguro agricola', 'medieria', 'canon', 'compraventa grano'], fn: () => this._skillContratos(text) },

      // --- SKILL: Contenido & Marketing Agro ---
      { keys: ['contenido', 'post', 'linkedin', 'instagram', 'marketing', 'newsletter', 'blog', 'pitch', 'copy', 'divulgacion'], fn: () => this._skillContenido(text) },

      // --- SKILL: Web & Diseño ---
      { keys: ['pagina web', 'landing', 'sitio web', 'web', 'hosting', 'dominio', 'wordpress', 'react', 'seo', 'diseño web'], fn: () => this._skillWeb(text) },

      // --- SKILL: Fenología & Cultivos ---
      { keys: ['fenologia', 'etapa fenologica', 'crecimiento', 'floracion', 'maduracion', 'llenado grano', 'macollaje'], fn: () => this._skillFenologia(text) },

      // --- Nutrientes individuales ---
      { keys: ['nitrogeno', 'fosforo', 'potasio', 'calcio', 'magnesio', 'azufre', 'boro', 'cobre', 'hierro', 'manganeso', 'zinc', 'molibdeno', 'cloro'], fn: () => this._skillNutriente(text) },

      // --- SKILL: Interpolación & Geoestadística ---
      { keys: ['interpolacion', 'kriging', 'idw', 'variograma', 'semivariograma', 'geoestadistica', 'validacion cruzada'], fn: () => this._skillInterpolacion(text) },
    ];

    for (const skill of skills) {
      if (this._matchIntent(text, skill.keys)) {
        skill.fn();
        return true;
      }
    }
    return false;
  }

  // ===== SKILL: Interpretación de Suelos =====

  _skillInterpretacionSuelos(text) {
    this._addMessage(
      '**Interpretación de Análisis de Suelo:**\n\n' +
      '**Metodologías disponibles:**\n' +
      '- **Sufficiency Level** — Rangos críticos por cultivo (Bajo/Medio/Alto)\n' +
      '- **Balance nutricional** — Relaciones Ca:Mg:K en CTC\n' +
      '- **DRIS/CND** — Para diagnóstico cruzado suelo-hoja\n\n' +
      '**Parámetros evaluados:**\n' +
      '- pH (H₂O o CaCl₂), MO, P (Mehlich/Resina)\n' +
      '- Bases: K, Ca, Mg, Na | Acidez: Al, H+Al\n' +
      '- Micros: S, B, Cu, Fe, Mn, Zn\n' +
      '- Derivados: CTC, SB, V%, m%\n' +
      '- Textura: arcilla, arena, limo\n\n' +
      '**Cultivos soportados:** Caña, soja, maíz, sorgo, girasol, chía, tomate, pimentón, papa, maracuyá, palta.\n\n' +
      'Cargá tus datos en **Análisis de Suelo > Entrada de Datos** o importá CSV de IBRA.',
      'agent'
    );
  }

  _skillpH(text) {
    this._addMessage(
      '**pH del Suelo:**\n\n' +
      '**Rangos generales:**\n' +
      '- < 4.5: Muy ácido (toxicidad Al, deficiencia P/Ca/Mg)\n' +
      '- 4.5–5.4: Ácido (necesita encalado para la mayoría de cultivos)\n' +
      '- 5.5–6.5: Ideal para la mayoría de cultivos\n' +
      '- 6.5–7.5: Neutro (puede limitar micros: Fe, Mn, Zn)\n' +
      '- > 7.5: Alcalino (clorosis férrica, deficiencia Zn)\n\n' +
      '**Conversión:** pH CaCl₂ ≈ pH H₂O – 0.6\n\n' +
      '**Efecto sobre nutrientes:**\n' +
      '- pH bajo → Mayor disponibilidad de Fe, Mn, Cu, Zn, pero toxicidad Al\n' +
      '- pH alto → Mayor disponibilidad de Mo, pero bloqueo de P y micros\n\n' +
      'Para corregir pH, usá `/encalado` o consultame sobre cálculo de cal.',
      'agent'
    );
  }

  _skillCTC(text) {
    this._addMessage(
      '**CTC (Capacidad de Intercambio Catiónico):**\n\n' +
      '**Clasificación (pH 7):**\n' +
      '- < 5 cmolc/dm³: Muy baja (suelos arenosos)\n' +
      '- 5–15: Media\n' +
      '- 15–25: Alta\n' +
      '- > 25: Muy alta (suelos arcillosos/orgánicos)\n\n' +
      '**Composición ideal de la CTC:**\n' +
      '- Ca: 60–70%\n' +
      '- Mg: 10–20%\n' +
      '- K: 3–5%\n' +
      '- H+Al: 15–25% máximo\n' +
      '- Al: < 5%\n\n' +
      '**CTC efectiva (t) = SB + Al**\n' +
      '**CTC a pH 7 (T) = SB + H+Al**\n\n' +
      'La CTC influye en la capacidad buffer, retención de nutrientes y manejo de fertilización.',
      'agent'
    );
  }

  _skillSaturacion(text) {
    this._addMessage(
      '**Saturación de Bases (V%):**\n\n' +
      '**V% = (SB / CTC) × 100**\n' +
      'Donde SB = Ca + Mg + K + Na\n\n' +
      '**Metas por cultivo:**\n' +
      '- Caña de azúcar: 60%\n' +
      '- Soja: 50–60%\n' +
      '- Maíz: 50–70%\n' +
      '- Tomate: 70–80%\n' +
      '- Papa: 60%\n' +
      '- Palta: 60–70%\n' +
      '- Maracuyá: 60%\n\n' +
      '**Saturación de Al (m%):**\n' +
      '**m% = (Al / CTC_t) × 100**\n' +
      '- < 10%: Sin problemas\n' +
      '- 10–30%: Moderada (afecta cultivos sensibles)\n' +
      '- > 30%: Tóxica (requiere encalado urgente)',
      'agent'
    );
  }

  _skillMO(text) {
    this._addMessage(
      '**Materia Orgánica (MO):**\n\n' +
      '**Clasificación:**\n' +
      '- < 15 g/dm³: Bajo\n' +
      '- 15–30 g/dm³: Medio\n' +
      '- > 30 g/dm³: Alto\n\n' +
      '**Funciones clave:**\n' +
      '- Aporta N mineralizable (≈5% de MO = N disponible/año)\n' +
      '- Aumenta CTC (materia orgánica ≈ 200 cmolc/kg)\n' +
      '- Mejora estructura, retención de agua y actividad biológica\n' +
      '- Quelata micronutrientes (Fe, Mn, Cu, Zn)\n\n' +
      '**Estimación de N mineralizable:**\n' +
      'N disp. ≈ MO (g/dm³) × 0.05 × factor mineralización\n\n' +
      '**Manejo:** Rotación con gramíneas, cobertura, compost, abonos verdes.',
      'agent'
    );
  }

  _skillSalinidad(text) {
    this._addMessage(
      '**Salinidad y Sodicidad:**\n\n' +
      '**Conductividad Eléctrica (CE):**\n' +
      '- < 2 dS/m: Normal\n' +
      '- 2–4: Ligeramente salino\n' +
      '- 4–8: Moderadamente salino\n' +
      '- > 8: Fuertemente salino\n\n' +
      '**RAS (Relación de Adsorción de Sodio):**\n' +
      'RAS = Na / √((Ca+Mg)/2)\n' +
      '- < 6: Normal\n' +
      '- 6–12: Ligeramente sódico\n' +
      '- > 12: Sódico (requiere corrección con yeso)\n\n' +
      '**PSI (% Sodio Intercambiable):**\n' +
      '- < 6%: Normal\n' +
      '- 6–15%: Sódico\n' +
      '- > 15%: Fuertemente sódico\n\n' +
      '**Corrección:** Yeso agrícola (CaSO₄·2H₂O) para desplazar Na del complejo de cambio.',
      'agent'
    );
  }

  _skillTextura(text) {
    this._addMessage(
      '**Textura del Suelo:**\n\n' +
      '**Clasificación granulométrica:**\n' +
      '- Arena: > 65% arena → Baja CTC, alta infiltración, baja retención\n' +
      '- Franco: Balance de arena/limo/arcilla → Ideal para la mayoría de cultivos\n' +
      '- Arcilloso: > 35% arcilla → Alta CTC, buena retención, riesgo compactación\n\n' +
      '**Efecto en fertilización:**\n' +
      '- Arenosos: Dosis fraccionadas, mayor frecuencia, riesgo lixiviación K y N\n' +
      '- Arcillosos: Dosis mayores de K, P se fija más, mayor buffer pH\n\n' +
      '**Efecto en encalado:**\n' +
      '- Arenosos: Menor dosis de cal, efecto más rápido\n' +
      '- Arcillosos: Mayor dosis, efecto más lento pero más duradero\n\n' +
      '**Triángulo textural:** Arena (2–0.05mm), Limo (0.05–0.002mm), Arcilla (<0.002mm)',
      'agent'
    );
  }

  _skillAguaRiego(text) {
    this._addMessage(
      '**Calidad de Agua de Riego:**\n\n' +
      '**Parámetros clave:**\n' +
      '- CE: < 0.75 dS/m ideal, > 3 dS/m restricción severa\n' +
      '- pH: 6.5–8.4 aceptable\n' +
      '- RAS: < 6 sin restricción\n' +
      '- Cloruros: < 140 mg/L ideal\n' +
      '- Bicarbonatos: < 90 mg/L ideal\n' +
      '- Boro: < 0.7 mg/L ideal, > 3 mg/L tóxico\n\n' +
      '**Clasificación USDA:**\n' +
      '- C1-S1: Baja salinidad, bajo sodio (excelente)\n' +
      '- C2-S1: Salinidad media (aceptable)\n' +
      '- C3-S2: Alta salinidad (restricciones)\n' +
      '- C4-S4: Muy alta salinidad y sodio (inaceptable)\n\n' +
      'Para análisis completo, cargá los datos de agua en la sección correspondiente.',
      'agent'
    );
  }

  // ===== SKILL: Foliar & DRIS =====

  _skillFoliar(text) {
    this._addMessage(
      '**Análisis Foliar — DRIS/IBN/CND:**\n\n' +
      '**Métodos de diagnóstico:**\n' +
      '- **Sufficiency (Rango de Suficiencia):** Compara con rangos tabulados por cultivo\n' +
      '- **DRIS:** Índices balanceados usando relaciones binarias (N/P, N/K, etc.)\n' +
      '- **CND (Diagnóstico Composicional de Nutrientes):** Multivariado, más robusto\n\n' +
      '**IBN (Índice de Balance Nutricional):**\n' +
      'IBN = Σ|índices DRIS| → Menor IBN = mejor balance\n\n' +
      '**Nutrientes evaluados:**\n' +
      'N, P, K, Ca, Mg, S, B, Cu, Fe, Mn, Zn\n\n' +
      '**Época de muestreo:**\n' +
      '- Caña: Hoja +3, 4-6 meses\n' +
      '- Soja: Tercera hoja trifoliada, R1-R2\n' +
      '- Maíz: Hoja opuesta y debajo de la espiga, VT-R1\n' +
      '- Tomate: 4ª hoja desde el ápice, inicio floración\n\n' +
      'Cargá datos en **Análisis Foliar** para diagnóstico automático.',
      'agent'
    );
  }

  // ===== SKILL: Relaciones entre Nutrientes =====

  _skillRelaciones(text) {
    this._addMessage(
      '**Relaciones entre Nutrientes:**\n\n' +
      '**Relaciones en suelo (cmolc/dm³):**\n' +
      '- Ca/Mg: 3:1 a 5:1 (ideal 3-4)\n' +
      '- Ca/K: 12:1 a 20:1 (ideal 15)\n' +
      '- Mg/K: 3:1 a 6:1 (ideal 4)\n' +
      '- (Ca+Mg)/K: 15:1 a 25:1\n\n' +
      '**En la CTC (% ocupación):**\n' +
      '- Ca: 60-70%\n' +
      '- Mg: 10-20%\n' +
      '- K: 3-5%\n\n' +
      '**Antagonismos importantes:**\n' +
      '- Exceso Ca → inhibe absorción Mg, K, B, Mn, Zn\n' +
      '- Exceso K → inhibe absorción Ca, Mg\n' +
      '- Exceso P → inhibe absorción Zn, Cu, Fe\n' +
      '- Exceso Fe → inhibe absorción Mn\n\n' +
      '**Sinergias:**\n' +
      '- N + Mo mejora fijación biológica\n' +
      '- P + micorrizas mejora absorción\n' +
      '- Ca + B mejora pared celular\n\n' +
      'Revisá el módulo **Relaciones** en Análisis de Suelo para gráficos detallados.',
      'agent'
    );
  }

  // ===== SKILL: Fertilización =====

  _skillFertilizacion(text) {
    this._addMessage(
      '**Recomendación de Fertilización:**\n\n' +
      '**Motor de cálculo disponible para:**\n' +
      'Caña, soja, maíz, sorgo, girasol, chía, tomate, pimentón, papa, maracuyá, palta\n\n' +
      '**Metodología:**\n' +
      '1. Meta de rendimiento × extracción/exportación = demanda\n' +
      '2. Disponibilidad en suelo (análisis) = suministro\n' +
      '3. (Demanda - suministro) / eficiencia = dosis nutriente\n' +
      '4. Dosis nutriente → conversión a producto comercial\n\n' +
      '**Salidas:**\n' +
      '- kg nutriente/ha, kg producto/ha\n' +
      '- g/planta (para frutales y hortalizas)\n' +
      '- Total lote (kg totales)\n' +
      '- Calendarización por etapa fenológica\n\n' +
      '**Eficiencias de absorción (referencia):**\n' +
      '- N: 50-70%, P: 20-30%, K: 60-80%\n' +
      '- Ca: 30-40%, Mg: 30-40%, S: 40-60%\n\n' +
      'Configurá el cultivo y la meta en el Dashboard, cargá análisis de suelo, y accedé a **Correcciones y Enmiendas**.',
      'agent'
    );
  }

  _skillEncalado(text) {
    this._addMessage(
      '**Encalado y Enmiendas:**\n\n' +
      '**Método por saturación de bases:**\n' +
      'NC (t/ha) = CTC × (V₂ - V₁) / (10 × PRNT)\n' +
      '- V₂ = meta (ej: 60% para caña)\n' +
      '- V₁ = V% actual del análisis\n' +
      '- PRNT = Poder Relativo de Neutralización Total\n\n' +
      '**Método por neutralización de Al:**\n' +
      'NC = Al × 2 + [2 - (Ca+Mg)]\n\n' +
      '**Tipos de caliza:**\n' +
      '- Calcítica: CaCO₃ (> 40% CaO, < 5% MgO)\n' +
      '- Dolomítica: CaMg(CO₃)₂ (> 12% MgO)\n' +
      '- Elegir según relación Ca/Mg del suelo\n\n' +
      '**Yeso agrícola (CaSO₄·2H₂O):**\n' +
      '- Corrige subsuelo (20-40 cm) sin alterar pH\n' +
      '- Dosis: 0.5-1.5 t/ha según m% y textura\n' +
      '- Necesario cuando: m% subsup > 20% o Ca < 5 mmolc/dm³\n\n' +
      '**Aplicación:** 60-90 días antes de la siembra, incorporar 0-20 cm.',
      'agent'
    );
  }

  // ===== SKILL: Zonas de Manejo & GIS =====

  _skillZonasManejo(text) {
    this._addMessage(
      '**Zonas de Manejo / Ambientes Productivos / UGDs:**\n\n' +
      '**Concepto:** Áreas homogéneas dentro de un lote con similar potencial productivo.\n\n' +
      '**Capas de información utilizadas:**\n' +
      '- Análisis de suelo (multitemporal, mín. 3 campañas)\n' +
      '- NDVI/NDRE multitemporal\n' +
      '- Mapas de rendimiento\n' +
      '- Planialtimetría (MDE/DEM)\n' +
      '- TWI (Índice Topográfico de Humedad)\n' +
      '- Conductividad eléctrica aparente (CEa)\n\n' +
      '**Algoritmos:**\n' +
      '- K-Means++ con Lloyd (motor principal)\n' +
      '- Análisis de estabilidad temporal (CV entre campañas)\n' +
      '- Variables ponderadas por el usuario\n\n' +
      '**UGDs (Unidades de Gestión Diferenciada):**\n' +
      '- Subdivisión de zonas de manejo por variable limitante\n' +
      '- Permite prescripción sitio-específica\n\n' +
      'Accedé desde **Mapas GIS > Zonas de Manejo** (5 pasos wizard).',
      'agent'
    );
  }

  _skillIndicesVegetacion(text) {
    this._addMessage(
      '**Índices de Vegetación:**\n\n' +
      '**Índices principales:**\n' +
      '- **NDVI** = (NIR-Red)/(NIR+Red) → Vigor general, cobertura\n' +
      '- **NDRE** = (NIR-RE)/(NIR+RE) → Mejor para clorofila/N en dosel denso\n' +
      '- **EVI** = 2.5×(NIR-Red)/(NIR+6×Red-7.5×Blue+1) → Corrige atmósfera\n' +
      '- **SAVI** = (NIR-Red)/(NIR+Red+L)×(1+L) → Corrige suelo expuesto (L=0.5)\n' +
      '- **MSAVI** = Auto-ajusta L → Mejor en cobertura parcial\n\n' +
      '**Uso por etapa fenológica:**\n' +
      '- Emergencia/inicial: SAVI, MSAVI (suelo visible)\n' +
      '- Vegetativo: NDVI, EVI\n' +
      '- Reproductivo/madurez: NDRE (saturación NDVI)\n\n' +
      '**Fuentes de imágenes:**\n' +
      '- Sentinel-2: 10m, 5 días (gratis)\n' +
      '- Planet: 3m, diario (comercial)\n' +
      '- Drone: <5cm (vuelo propio)\n\n' +
      'DataFarm provee IIF (Índice de Fuerza Interna) como índice propietario.',
      'agent'
    );
  }

  _skillFirmaEspectral(text) {
    this._addMessage(
      '**Firma Espectral y Clasificación de Cultivos:**\n\n' +
      '**Bandas clave:**\n' +
      '- Blue (490nm): absorción clorofila b\n' +
      '- Green (560nm): pico reflectancia verde\n' +
      '- Red (665nm): absorción clorofila a\n' +
      '- Red Edge (705-740nm): transición, sensible a clorofila\n' +
      '- NIR (842nm): estructura celular, alta reflectancia\n' +
      '- SWIR (1610nm): contenido agua, lignina\n\n' +
      '**Diferenciación por cultivo:**\n' +
      '- Soja vs Maíz: diferencia en Red Edge y NIR\n' +
      '- Caña vs pasturas: SWIR y textura temporal\n' +
      '- Cultivos de cobertura: patrón estacional NDVI\n\n' +
      '**Algoritmos de clasificación:**\n' +
      '- Random Forest, SVM, redes neuronales\n' +
      '- Series temporales de NDVI (fenología)\n' +
      '- Análisis multitemporal Sentinel-2',
      'agent'
    );
  }

  _skillDeteccionMalezas(text) {
    if (text.includes('falla') || text.includes('restitucion') || text.includes('linea')) {
      this._addMessage(
        '**Detección de Fallas de Plantío y Restitución de Líneas:**\n\n' +
        '**Fallas de plantío:**\n' +
        '- Detección por NDVI en etapa temprana (30-60 días)\n' +
        '- Umbral NDVI < 0.3 sobre línea de siembra = falla\n' +
        '- Cuantificación en metros lineales y % falla\n\n' +
        '**Restitución de líneas (caña):**\n' +
        '- Análisis de perfil transversal al surco\n' +
        '- Detección de gaps > 0.5m en la línea\n' +
        '- Mapa de densidad de tallos estimada\n' +
        '- Recomendación de replantío por zona',
        'agent'
      );
    } else {
      this._addMessage(
        '**Detección de Malezas:**\n\n' +
        '**Métodos de detección:**\n' +
        '- **NDVI diferencial:** Comparar NDVI esperado vs observado\n' +
        '- **Análisis de textura:** Malezas crean patrones irregulares\n' +
        '- **Object-Based Image Analysis (OBIA):** Segmentación + clasificación\n' +
        '- **Deep Learning:** CNNs para detección pixel a pixel\n\n' +
        '**Flujo de trabajo:**\n' +
        '1. Vuelo drone RGB/multiespectral\n' +
        '2. Ortomosaico y clasificación\n' +
        '3. Mapa de infestación por especie\n' +
        '4. Prescripción de herbicida sitio-específica\n\n' +
        '**Integración MIP:** Combinar con biocontrol, manejo cultural, y químico selectivo.',
        'agent'
      );
    }
  }

  _skillPrescripcion(text) {
    this._addMessage(
      '**Prescripción VRT (Tasa Variable):**\n\n' +
      '**Flujo completo:**\n' +
      '1. Análisis de suelo georreferenciado\n' +
      '2. Interpolación (IDW/Kriging) → mapa continuo\n' +
      '3. Zonas de manejo o pixel a pixel\n' +
      '4. Cálculo de dosis por zona/pixel\n' +
      '5. Exportación a formato de monitor\n\n' +
      '**Formatos de exportación:**\n' +
      '- Shapefile (.shp) → Compatible universal\n' +
      '- ISO-XML → ISOBUS\n' +
      '- Trimble (.agdata)\n' +
      '- CSV georreferenciado\n\n' +
      '**Productos prescribibles:**\n' +
      '- Cal/Yeso, Fertilizantes (NPK, urea, MAP, KCl)\n' +
      '- Semillas (densidad variable)\n' +
      '- Agroquímicos (herbicidas, fungicidas)\n\n' +
      'Accedé desde **Mapas GIS > Prescripción VRT**.',
      'agent'
    );
  }

  _skillMuestreo(text) {
    this._addMessage(
      '**Puntos de Muestreo:**\n\n' +
      '**Métodos de grillado:**\n' +
      '- **Grid regular:** Cuadrícula uniforme (1-5 ha/punto)\n' +
      '- **Estratificado:** Por zonas de manejo (mayor densidad en zonas variables)\n' +
      '- **Centroide de zona:** 1 punto representativo por zona\n' +
      '- **Aleatorio:** Random dentro de zonas (validación)\n\n' +
      '**Densidad recomendada:**\n' +
      '- Detallado: 1 punto cada 1-2 ha\n' +
      '- Standard: 1 punto cada 3-5 ha\n' +
      '- Extensivo: 1 punto cada 5-10 ha\n\n' +
      '**Exportación:**\n' +
      '- GPX → GPS Garmin / celular\n' +
      '- KML → Google Earth\n' +
      '- GeoJSON → GIS desktop\n' +
      '- CSV → Excel / PIX Muestreo\n\n' +
      '**App de campo:** PIX Muestreo para navegación, colecta y georreferenciación.\n' +
      'Accedé desde **Mapas GIS > Puntos de Muestreo**.',
      'agent'
    );
  }

  // ===== SKILL: DataFarm / IBRA =====

  _skillDataFarm(text) {
    this._addMessage(
      '**DataFarm / IBRA Megalab:**\n\n' +
      '**Plataforma DataFarm:**\n' +
      '- Cadastro de haciendas y talhões con perímetro\n' +
      '- Imágenes satélite: NDVI, IIF (Índice Interno de Fuerza), RGB\n' +
      '- Zonas de manejo automáticas y manuales\n' +
      '- Grids de muestreo configurables\n' +
      '- Mapa altimétrico ALOS (30m)\n' +
      '- Yield Gap analysis\n' +
      '- Scouting y monitoreo de campo\n\n' +
      '**IBRA Megalab:**\n' +
      '- Lab Online: consulta de resultados web\n' +
      '- App de colecta georreferenciada (IBRA Coleta)\n' +
      '- Resultados por email en CSV/PDF\n' +
      '- Mapas de fertilidad automáticos\n\n' +
      '**Integración con PIX Admin:**\n' +
      '- Importar CSV de IBRA → auto-rellenar análisis\n' +
      '- Exportar puntos PIX → compatible con DataFarm Coleta\n' +
      '- Monitoreo email para resultados IBRA automáticos\n\n' +
      'Usá `/importar-ibra` para cargar resultados de laboratorio.',
      'agent'
    );
  }

  // ===== SKILL: Biocontrol de Plagas =====

  _skillBiocontrol(text) {
    this._addMessage(
      '**Biocontrol de Plagas y Enfermedades:**\n\n' +
      '**Entomopatógenos:**\n' +
      '- **Beauveria bassiana:** Mosca blanca, picudo, chinches\n' +
      '- **Metarhizium anisopliae:** Cigarrinha (caña), gorgojo, salivazo\n' +
      '- **Bt (Bacillus thuringiensis):** Lepidópteros (Spodoptera, Helicoverpa)\n' +
      '- **NPV (Baculovirus):** Específicos por especie\n\n' +
      '**Parasitoides:**\n' +
      '- **Trichogramma:** Huevos de lepidópteros\n' +
      '- **Cotesia flavipes:** Larvas de Diatraea (broca de caña)\n' +
      '- **Telenomus remus:** Huevos de Spodoptera\n\n' +
      '**Biofungicidas:**\n' +
      '- **Trichoderma harzianum:** Fusarium, Rhizoctonia, Sclerotinia\n' +
      '- **Bacillus subtilis:** Oidio, mildiu, manchas foliares\n' +
      '- **B. amyloliquefaciens:** Amplio espectro antifúngico\n\n' +
      '**NEPs (Nematodos Entomopatógenos):**\n' +
      '- Steinernema, Heterorhabditis → plagas de suelo\n\n' +
      '**MIP:** Integrar biocontrol + cultural + químico selectivo. Respetar umbrales de acción.',
      'agent'
    );
  }

  // ===== SKILL: Biotech Microbianos =====

  _skillBiotechMicrobianos(text) {
    this._addMessage(
      '**Biotecnología Microbiana Agrícola:**\n\n' +
      '**PGPR (Rizobacterias Promotoras):**\n' +
      '- **Azospirillum brasilense:** Fijación N, AIA, etileno. Maíz/sorgo/trigo\n' +
      '- **Bradyrhizobium japonicum:** FBN en soja (>300 kg N/ha)\n' +
      '- **Pseudomonas fluorescens:** Solubilización P, sideróforos, DAPG\n' +
      '- **Bacillus megaterium:** Solubilización P, producción AIA\n\n' +
      '**Consorcios microbianos:**\n' +
      '- Azospirillum + Bradyrhizobium (soja: FBN + estimulación)\n' +
      '- Trichoderma + Bacillus (biocontrol + promoción)\n' +
      '- Micorrizas + PGPR (absorción P + protección)\n\n' +
      '**Formulaciones:**\n' +
      '- Líquida concentrada (inoculación en surco)\n' +
      '- Turba (tratamiento de semilla)\n' +
      '- Granulado (aplicación en suelo)\n' +
      '- WP polvo mojable (foliar/drench)\n\n' +
      '**Compatibilidad:** Verificar siempre con fungicidas TS. Inocular a la sombra.',
      'agent'
    );
  }

  // ===== SKILL: Metabolitos Bioactivos =====

  _skillMetabolitos(text) {
    this._addMessage(
      '**Metabolitos Microbianos Bioactivos:**\n\n' +
      '**Lipopéptidos (Bacillus spp.):**\n' +
      '- **Surfactinas:** Biosurfactante, rompe membranas\n' +
      '- **Iturinas:** Antifúngico potente, forma poros\n' +
      '- **Fengicinas:** Inhibe fosfolipasa, antifúngico\n\n' +
      '**VOCs (Compuestos Orgánicos Volátiles):**\n' +
      '- Acetoína, 2,3-butanediol → Promoción crecimiento, ISR\n' +
      '- Dimetil disulfuro → Antifúngico, nematicida\n\n' +
      '**Enzimas líticas:**\n' +
      '- Quitinasas, glucanasas → Degradan pared fúngica\n' +
      '- Proteasas → Degradan cutícula de insectos\n\n' +
      '**Sideróforos:**\n' +
      '- Pioverdina (Pseudomonas) → Secuestra Fe³⁺\n' +
      '- Bacilibactina (Bacillus) → Competencia por Fe\n\n' +
      '**Antibióticos:**\n' +
      '- DAPG (Pseudomonas) → Amplio espectro antifúngico\n' +
      '- Fenazinas → Antifúngico, redox cycling\n' +
      '- Pirrolnitrina → Antifúngico potente',
      'agent'
    );
  }

  // ===== SKILL: Bioestimulantes =====

  _skillBioestimulantes(text) {
    this._addMessage(
      '**Bioestimulantes:**\n\n' +
      '**Ácidos húmicos/fúlvicos:**\n' +
      '- Mejoran CTC, complejación de nutrientes\n' +
      '- Estimulan crecimiento radical (efecto auxínico)\n' +
      '- Dosis: 2-5 L/ha vía suelo, 0.5-1 L/ha foliar\n\n' +
      '**Extractos de algas (Ascophyllum nodosum):**\n' +
      '- Citoquininas, betaínas, manitol, alginatos\n' +
      '- Anti-estrés (hídrico, térmico, salino)\n' +
      '- Dosis foliar: 1-2 L/ha\n\n' +
      '**Quitosano:**\n' +
      '- Elicitor de defensa (SAR/ISR)\n' +
      '- Antimicrobiano directo\n' +
      '- Compatible con biocontrol\n\n' +
      '**Aminoácidos libres:**\n' +
      '- Glicina, prolina, glutamato\n' +
      '- Quelatan micronutrientes\n' +
      '- Anti-estrés osmótico\n\n' +
      '**Aplicación:** Preferir momentos de demanda (crecimiento activo, estrés, floración).',
      'agent'
    );
  }

  // ===== SKILL: Contratos Agrícolas =====

  _skillContratos(text) {
    this._addMessage(
      '**Contratos Agrícolas:**\n\n' +
      '**Tipos principales:**\n' +
      '- **Arrendamiento rural:** Canon fijo (qq/ha o $/ha). Plazos mínimos legales\n' +
      '- **Aparcería/Mediería:** % de producción. Riesgos compartidos\n' +
      '- **Compraventa de granos:** Forward, con/sin precio fijo\n' +
      '- **Servicios agrícolas:** Siembra, cosecha, fumigación ($/ha)\n' +
      '- **Leasing de maquinaria:** Opción de compra al final\n' +
      '- **Fideicomiso agropecuario:** Pool de siembra\n\n' +
      '**Cláusulas clave:**\n' +
      '- Fuerza mayor (sequía, inundación, helada)\n' +
      '- Jurisdicción y resolución de conflictos\n' +
      '- Seguro agrícola obligatorio\n' +
      '- Buenas prácticas agrícolas (BPA)\n' +
      '- Devolución del campo (estado del suelo)\n\n' +
      '**Consejo:** Siempre formalizar por escrito. Consultar con abogado agrario.',
      'agent'
    );
  }

  // ===== SKILL: Contenido Agro =====

  _skillContenido(text) {
    this._addMessage(
      '**Creación de Contenido Agro:**\n\n' +
      '**Formatos disponibles:**\n' +
      '- Posts LinkedIn/Instagram (técnico-comercial)\n' +
      '- Artículos técnicos (blog, newsletter)\n' +
      '- Guiones de video (YouTube, Reels)\n' +
      '- Casos de éxito / testimonios\n' +
      '- Pitch decks para inversores\n' +
      '- Email marketing campaigns\n' +
      '- Infografías técnicas\n\n' +
      '**Temas Pixadvisor:**\n' +
      '- Agricultura de precisión\n' +
      '- Drones y percepción remota\n' +
      '- Mapeo satelital y GIS\n' +
      '- Muestreo inteligente\n' +
      '- Tasa variable (VRT)\n' +
      '- Resultados de campo (ROI)\n\n' +
      'Pedime que genere contenido específico: ej. "post LinkedIn sobre zonas de manejo".',
      'agent'
    );
  }

  // ===== SKILL: Web & Diseño =====

  _skillWeb(text) {
    this._addMessage(
      '**Desarrollo Web Agro:**\n\n' +
      '**Servicios:**\n' +
      '- Landing pages para servicios de AP\n' +
      '- Sitios corporativos (React/Next.js/WordPress)\n' +
      '- Portafolios de proyectos GIS\n' +
      '- E-commerce de servicios agro\n\n' +
      '**SEO Agro:**\n' +
      '- Keywords: agricultura de precisión, muestreo de suelo, mapas de rendimiento\n' +
      '- Contenido técnico optimizado\n' +
      '- Schema markup para servicios locales\n\n' +
      '**Hosting recomendado:**\n' +
      '- Vercel/Netlify (React/Next.js)\n' +
      '- Cloudflare Pages (estáticos)\n' +
      '- SiteGround/Hostinger (WordPress)\n\n' +
      '**Branding Pixadvisor:**\n' +
      '- Verde: #7FD633 | Teal: #0d9488\n' +
      '- Dark: #0F1B2D | Font: Inter\n' +
      '- Gradiente: linear-gradient(135deg, #7FD633, #0d9488)',
      'agent'
    );
  }

  // ===== SKILL: Fenología =====

  _skillFenologia(text) {
    this._addMessage(
      '**Etapas Fenológicas por Cultivo:**\n\n' +
      '**Caña de azúcar:**\n' +
      'Brotación → Macollaje → Gran crecimiento → Maduración\n' +
      '- N: 60% macollaje, 40% gran crecimiento\n' +
      '- K: 50% plantío, 50% macollaje\n\n' +
      '**Soja:**\n' +
      'VE → VC → V1-Vn → R1 (flor) → R3-R5 (vaina/llenado) → R7-R8\n' +
      '- Período crítico: R1-R5 (definición rendimiento)\n' +
      '- Foliar Mn/Mo: V4-R1\n\n' +
      '**Maíz:**\n' +
      'VE → V2-V6 → V8-V12 → VT (espigamiento) → R1-R6\n' +
      '- N: 30% V4, 70% V8\n' +
      '- Período crítico: V12-R2\n\n' +
      '**Tomate:**\n' +
      'Transplante → Vegetativo → Floración → Cuaje → Maduración\n' +
      '- Ca+B: floración-cuaje (previene BER)\n' +
      '- K: llenado-maduración (calidad fruto)',
      'agent'
    );
  }

  // ===== SKILL: Nutrientes Individuales =====

  _skillNutriente(text) {
    const info = {
      'nitrogeno': '**Nitrógeno (N):**\n- Función: Proteínas, clorofila, crecimiento vegetativo\n- Deficiencia: Amarillamiento hojas viejas, crecimiento reducido\n- Fuentes: Urea (45% N), Sulfato amonio (21% N+24% S), UAN\n- Manejo: Fraccionar, evitar lixiviación, sincronizar con demanda\n- Interacción: Mo necesario para FBN, exceso reduce calidad fruta',
      'fosforo': '**Fósforo (P):**\n- Función: Energía (ATP), raíces, floración, semillas\n- Deficiencia: Púrpura en hojas viejas, raíces cortas\n- Fuentes: MAP (52% P₂O₅), SFT (46%), DAP (46%+18%N)\n- Manejo: Aplicar en banda, baja movilidad, pH 5.5-6.5 ideal\n- Mehlich-1 o Resina: verificar método del lab',
      'potasio': '**Potasio (K):**\n- Función: Regulación estomática, translocación, calidad\n- Deficiencia: Necrosis bordes hojas viejas, marchitez\n- Fuentes: KCl (60% K₂O), K₂SO₄ (50%+18%S), vinaza\n- Manejo: Cuidar relación K/Ca/Mg, no exceder 5% CTC\n- Caña: Alta demanda, responde bien a vinaza',
      'calcio': '**Calcio (Ca):**\n- Función: Pared celular, división celular, calidad frutos\n- Deficiencia: BER en tomate, tip burn, punta quemada\n- Fuentes: Cal, yeso, nitrato de calcio\n- Meta en CTC: 60-70%\n- Baja movilidad en planta: aplicar foliar en floración-cuaje',
      'magnesio': '**Magnesio (Mg):**\n- Función: Centro de clorofila, activador enzimático, translocación P\n- Deficiencia: Clorosis internerval en hojas viejas\n- Fuentes: Cal dolomítica, sulfato Mg, óxido Mg\n- Meta en CTC: 10-20%\n- Relación Ca/Mg: 3:1 a 5:1 ideal',
      'azufre': '**Azufre (S):**\n- Función: Aminoácidos (cisteína, metionina), aceites\n- Deficiencia: Similar a N pero en hojas NUEVAS (amarillamiento uniforme)\n- Fuentes: Sulfato amonio (24%S), yeso (15%S), azufre elemental\n- Importante para soja (proteína) y crucíferas',
      'boro': '**Boro (B):**\n- Función: Pared celular, germinación polen, transporte azúcares\n- Deficiencia: Corazón hueco (papa), frutos deformes, muerte apical\n- Fuentes: Bórax (11%B), ácido bórico (17%B), ulexita\n- Rango estrecho entre deficiencia y toxicidad\n- Foliar: 1-2 kg/ha bórax en floración',
      'cobre': '**Cobre (Cu):**\n- Función: Enzimas oxidasas, lignificación, fertilidad polen\n- Deficiencia: Raro, hojas jóvenes enrolladas, espigas vacías (cereales)\n- Fuentes: Sulfato Cu (25%Cu), fungicidas cúpricos\n- Exceso MO reduce disponibilidad (quelación)\n- Acumula en suelo: cuidado con dosis excesivas',
      'hierro': '**Hierro (Fe):**\n- Función: Citocromos, ferredoxina, síntesis clorofila\n- Deficiencia: Clorosis internerval en hojas JÓVENES (pH alto)\n- Fuentes: Sulfato Fe, quelatos (Fe-EDDHA para pH>7)\n- pH > 7: deficiencia inducida (clorosis férrica)\n- Antagonismo con Mn, Zn, P en exceso',
      'manganeso': '**Manganeso (Mn):**\n- Función: Fotosíntesis (PSII), activación enzimática\n- Deficiencia: Clorosis internerval moteada, hojas jóvenes (soja!)\n- Fuentes: Sulfato Mn (31%Mn), MnO, quelatos\n- Soja es MUY sensible: monitorear en V4-R1\n- pH alto y exceso MO reducen disponibilidad',
      'zinc': '**Zinc (Zn):**\n- Función: Auxinas, anhidrasa carbónica, RNA polimerasa\n- Deficiencia: Hojas pequeñas, entrenudos cortos, clorosis\n- Fuentes: Sulfato Zn (22%Zn), óxido Zn, quelatos\n- Maíz es sensible: aplicar 3-5 kg ZnSO₄/ha\n- Antagonismo con P (relación P/Zn > 400 = deficiencia)',
      'molibdeno': '**Molibdeno (Mo):**\n- Función: Nitrato reductasa, nitrogenasa (FBN)\n- Deficiencia: Similar a N (hojas viejas amarillas)\n- Fuentes: Molibdato sodio/amonio, TS en soja\n- Crítico para soja (FBN) y leguminosas\n- Disponibilidad AUMENTA con pH (único micro así)',
      'cloro': '**Cloro (Cl):**\n- Función: Fotólisis agua (PSII), regulación osmótica\n- Deficiencia: Muy rara (ubicuo en suelos)\n- Fuentes: KCl, agua de riego\n- Exceso: Toxicidad en tabaco, papa, frutales sensibles\n- Salinidad: Cl > 10 meq/L en extracto saturado = problema'
    };

    for (const [nutrient, response] of Object.entries(info)) {
      if (text.includes(nutrient)) {
        this._addMessage(response, 'agent');
        return;
      }
    }

    this._addMessage('Preguntame sobre un nutriente específico: N, P, K, Ca, Mg, S, B, Cu, Fe, Mn, Zn, Mo, Cl.', 'agent');
  }

  // ===== SKILL: Interpolación =====

  _skillInterpolacion(text) {
    this._addMessage(
      '**Motor de Interpolación & Geoestadística:**\n\n' +
      '**IDW (Inverse Distance Weighting):**\n' +
      '- Determinístico, rápido, sin supuestos\n' +
      '- Parámetro: potencia (p=2 estándar)\n' +
      '- No estima error ni varianza\n\n' +
      '**Kriging:**\n' +
      '- Geoestadístico, BLUE (Best Linear Unbiased Estimator)\n' +
      '- Requiere variograma (estructura espacial)\n' +
      '- Provee mapa de varianza/error\n' +
      '- Modelos: esférico, exponencial, gaussiano\n\n' +
      '**Variograma:**\n' +
      '- Nugget (C₀): variación a distancia 0 (error medición)\n' +
      '- Sill (C₀+C): meseta de variación\n' +
      '- Range (a): distancia de autocorrelación\n' +
      '- IDE = C/(C₀+C): >0.75 fuerte dependencia espacial\n\n' +
      '**Validación cruzada:**\n' +
      '- Leave-One-Out, K-Fold\n' +
      '- Métricas: RMSE, MAE, R², ME (sesgo)\n\n' +
      'Configurá en **Motor Interpolación** del menú lateral.',
      'agent'
    );
  }

  // ===== SKILL: Workflow / Documentos =====

  _skillWorkflow(text) {
    this._addMessage(
      '**Generación de Documentos Pixadvisor:**\n\n' +
      '**Tipos de documento:**\n' +
      '- **Protocolo de Aplicación:** Dosis, fuentes, calendario, maquinaria\n' +
      '- **Estudio Financiero:** ROI, costo/beneficio, comparativa escenarios\n' +
      '- **Resumen Ejecutivo:** Diagnóstico + recomendación en 1 página\n' +
      '- **Relatório Foliar:** Resultados DRIS/IBN + recomendaciones\n' +
      '- **Mapa de Prescripción:** VRT con leyenda y tabla de aplicación\n\n' +
      '**Estructura de salida:**\n' +
      '- kg nutriente/ha → g/planta → total lote\n' +
      '- Calendarización por etapa fenológica\n' +
      '- Branding Pixadvisor (logo, colores, footer)\n\n' +
      '**Exportación:**\n' +
      '- PDF profesional (desde módulo Informes)\n' +
      '- Datos adjuntos: mapas, tablas, gráficos\n\n' +
      'Accedé a **Informes** en el menú lateral para generar documentos.',
      'agent'
    );
  }

  _getSmartResponse(text) {
    return '**PIX Agent — Módulos Especializados:**\n\n' +
      'Puedo ayudarte con todos estos temas:\n\n' +
      '**Análisis & Diagnóstico:**\n' +
      '- Interpretación de suelos, foliar, agua de riego\n' +
      '- DRIS/IBN/CND, relaciones entre nutrientes\n' +
      '- Nutrientes individuales (N, P, K, Ca, Mg, S, micros)\n\n' +
      '**Recomendaciones:**\n' +
      '- Fertilización (dosis, fuentes, calendario)\n' +
      '- Encalado y yeso (cálculo PRNT, V%)\n' +
      '- Bioestimulantes y biocontrol\n\n' +
      '**GIS & Mapas:**\n' +
      '- Zonas de manejo, NDVI, firma espectral\n' +
      '- Interpolación (IDW, Kriging, variograma)\n' +
      '- Prescripción VRT, puntos de muestreo\n' +
      '- Detección de malezas y fallas\n\n' +
      '**Biotecnología:**\n' +
      '- PGPR, biocontrol, metabolitos, consorcios\n\n' +
      '**Gestión:**\n' +
      '- Contratos, contenido agro, web, DataFarm/IBRA\n' +
      '- Documentos profesionales Pixadvisor\n\n' +
      'Preguntame directamente o usá `/ayuda` para comandos.';
  }

  // ===== COMMANDS =====

  handleCommand(cmd) {
    const command = cmd.replace('/', '').trim().split(' ')[0];

    switch (command) {
      case 'importar-ibra':
        this._addMessage('Abriendo selector de archivo CSV/Excel de IBRA megalab...', 'agent');
        setTimeout(() => this._triggerIbraImport(), 300);
        break;

      case 'estado':
        this.showSystemStatus();
        break;

      case 'errores':
        this.showErrors();
        break;

      case 'ayuda':
      case 'help':
        this.showHelp();
        break;

      case 'check-email':
        this._checkEmail();
        break;

      case 'auto-rellenar':
        this._addMessage('Para auto-rellenar, primero importá un CSV de IBRA con `/importar-ibra`. Los datos se cargarán automáticamente en el formulario de análisis de suelo.', 'agent');
        break;

      case 'limpiar':
        this.clearChat();
        break;

      case 'voz':
        this.toggleVoice();
        break;

      case 'automatizar':
        this.showAutomations();
        break;

      case 'demo-suelo':
        this.autoLoadDemoSoil();
        break;

      case 'demo-foliar':
        this.autoLoadDemoLeaf();
        break;

      case 'interpretar':
        this.autoInterpretSoil();
        break;

      case 'interpretar-hoja':
        this.autoInterpretLeaf();
        break;

      case 'reporte':
      case 'informe':
        this.autoGenerateReport();
        break;

      case 'navegar':
        const dest = cmd.split(' ').slice(1).join(' ');
        this.autoNavigate(dest);
        break;

      case 'cultivo':
        const crop = cmd.split(' ').slice(1).join(' ');
        this.autoSetCrop(crop);
        break;

      case 'exportar':
        this.autoExport();
        break;

      case 'resumen':
        this.autoFullSummary();
        break;

      case 'siguiente-muestra':
        this.autoNextSample();
        break;

      case 'validar':
        this.autoValidateAll();
        break;

      case 'limpiar-suelo':
        this.autoClearSoilForm();
        break;

      case 'workflow':
        this.autoWorkflow();
        break;

      case 'cliente':
      case 'registrar-cliente':
        this.autoRegisterClient();
        break;

      case 'set-cliente':
        const clientArgs = cmd.split(' ').slice(1).join(' ');
        if (clientArgs) {
          this._processClientData(clientArgs);
        } else {
          this.autoRegisterClient();
        }
        break;

      case 'propiedad':
      case 'hacienda':
        this.autoRegisterProperty();
        break;

      case 'lote':
        this.autoRegisterLot();
        break;

      case 'clientes':
      case 'listar-clientes':
        this._listClients();
        break;

      default:
        this._addMessage(`Comando desconocido: \`/${command}\`. Usá \`/ayuda\` para ver los comandos disponibles.`, 'agent');
    }
  }

  showHelp() {
    this._addMessage(
      '**Comandos — Sistema:**\n' +
      '`/estado` `/errores` `/check-email` `/voz` `/limpiar`\n\n' +
      '**Comandos — Automatización:**\n' +
      '`/importar-ibra` `/demo-suelo` `/demo-foliar`\n' +
      '`/interpretar` `/interpretar-hoja` `/reporte`\n' +
      '`/navegar [vista]` `/cultivo [nombre]`\n' +
      '`/validar` `/resumen` `/exportar`\n' +
      '`/workflow` — Ejecutar TODO automático\n' +
      '`/automatizar` — Ver lista completa\n\n' +
      '**Skills especializados (preguntá directamente):**\n' +
      '- **Suelos:** pH, CTC, V%, MO, textura, salinidad, agua de riego\n' +
      '- **Foliar:** DRIS, IBN, CND, Sufficiency, relaciones\n' +
      '- **Nutrientes:** N, P, K, Ca, Mg, S, B, Cu, Fe, Mn, Zn, Mo\n' +
      '- **Fertilización:** Dosis, encalado, yeso, calendario fenológico\n' +
      '- **GIS:** Zonas manejo, NDVI/NDRE, interpolación, Kriging, VRT\n' +
      '- **Biocontrol:** Beauveria, Trichoderma, Bt, parasitoides, MIP\n' +
      '- **Biotech:** PGPR, Azospirillum, consorcios, metabolitos\n' +
      '- **Gestión:** Contratos, contenido, web, DataFarm/IBRA\n' +
      '- **Documentos:** Protocolos, estudios financieros, informes',
      'agent'
    );
  }

  showSystemStatus() {
    const app = window.admin;
    const status = {
      cultivo: app ? app.cropId : 'N/A',
      muestras: app ? app.samples.length : 0,
      datosSuelo: app ? Object.keys(app.soilData).length : 0,
      datosHoja: app ? Object.keys(app.leafData).length : 0,
      boundary: app && app.fieldBoundary ? 'Cargado' : 'Sin cargar',
      areaHa: app ? app.fieldAreaHa : 0,
      errores: this.errorLog.length
    };

    this._addMessage(
      '**Estado del Sistema:**\n\n' +
      `Cultivo: **${status.cultivo}**\n` +
      `Muestras cargadas: **${status.muestras}**\n` +
      `Parámetros suelo: **${status.datosSuelo}**\n` +
      `Parámetros hoja: **${status.datosHoja}**\n` +
      `Perímetro: **${status.boundary}** (${status.areaHa} ha)\n` +
      `Errores capturados: **${status.errores}**\n` +
      `Agente: **v${this.version}** activo`,
      'agent'
    );
  }

  showErrors() {
    if (this.errorLog.length === 0) {
      this._addMessage('No hay errores registrados. El sistema funciona correctamente.', 'agent');
      return;
    }
    const last5 = this.errorLog.slice(-5);
    let text = `**Últimos ${last5.length} errores:**\n\n`;
    last5.forEach((e, i) => {
      const time = e.time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      text += `${i + 1}. \`[${time}]\` ${e.message}\n`;
    });
    text += '\nRevisá la consola del navegador para más detalles.';
    this._addMessage(text, 'agent');
  }

  showAutomations() {
    this._addMessage(
      '**Automatizaciones disponibles:**\n\n' +
      '**Datos & Importación:**\n' +
      '`/importar-ibra` — Importar CSV/Excel de IBRA y auto-rellenar\n' +
      '`/demo-suelo` — Cargar datos demo de análisis de suelo\n' +
      '`/demo-foliar` — Cargar datos demo de análisis foliar\n' +
      '`/limpiar-suelo` — Limpiar formulario de suelo\n' +
      '`/siguiente-muestra` — Cargar siguiente muestra IBRA\n\n' +
      '**Análisis & Reportes:**\n' +
      '`/interpretar` — Interpretar análisis de suelo automáticamente\n' +
      '`/interpretar-hoja` — Interpretar análisis foliar (DRIS)\n' +
      '`/reporte` — Generar informe completo\n' +
      '`/validar` — Validar todos los datos cargados\n' +
      '`/resumen` — Resumen ejecutivo de todo el análisis\n\n' +
      '**Navegación & Control:**\n' +
      '`/navegar [vista]` — Ir a una vista (ej: `/navegar zonas`)\n' +
      '`/cultivo [nombre]` — Cambiar cultivo (ej: `/cultivo soja`)\n' +
      '`/exportar` — Exportar datos actuales\n' +
      '`/workflow` — Ejecutar workflow completo automático\n\n' +
      '**Automáticos (siempre activos):**\n' +
      '- Monitoreo de errores en tiempo real\n' +
      '- Backup a localStorage cada 5 min\n' +
      '- Validación de rangos al cargar datos',
      'agent'
    );
  }

  // ===== ERROR MONITORING =====

  _setupErrorMonitor() {
    // Global error handler
    window.addEventListener('error', (event) => {
      this.errorLog.push({
        type: 'error',
        message: event.message || 'Error desconocido',
        file: event.filename,
        line: event.lineno,
        col: event.colno,
        time: new Date()
      });
      console.warn('[PIX Agent] Error capturado:', event.message);
      // Notify if panel open
      if (this.isOpen) {
        this._addMessage(`Error detectado: \`${event.message}\``, 'agent', 'system');
      } else {
        // Update badge
        const badge = document.getElementById('agentBadge');
        if (badge) {
          const n = parseInt(badge.textContent || '0') + 1;
          badge.textContent = n;
          badge.style.display = '';
        }
      }
    });

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Promise rejected';
      this.errorLog.push({
        type: 'promise',
        message: msg,
        time: new Date()
      });
      console.warn('[PIX Agent] Unhandled rejection:', msg);
    });

    // Periodic health check
    setInterval(() => this._healthCheck(), 60000);
  }

  _healthCheck() {
    // Check localStorage
    try {
      localStorage.setItem('_pix_agent_hc', '1');
      localStorage.removeItem('_pix_agent_hc');
    } catch (e) {
      this._addMessage('Advertencia: localStorage no disponible. Los datos podrían perderse.', 'agent', 'system');
    }

    // Check if admin app instance exists
    if (!window.admin) {
      this._addMessage('Advertencia: La instancia de PIX Admin no está disponible.', 'agent', 'system');
    }

    // Auto-backup
    this._autoBackup();
  }

  _autoBackup() {
    const app = window.admin;
    if (!app) return;
    try {
      const backup = {
        soilData: app.soilData,
        leafData: app.leafData,
        samples: app.samples,
        clientData: app.clientData,
        cropId: app.cropId,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('pix_admin_backup', JSON.stringify(backup));
    } catch (e) { /* silent */ }
  }

  // ===== IBRA CSV IMPORT =====

  _triggerIbraImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.xlsx,.xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this._addMessage(`Procesando archivo: **${file.name}** (${(file.size / 1024).toFixed(1)} KB)...`, 'agent');

      try {
        const ext = file.name.split('.').pop().toLowerCase();
        let rows;

        if (ext === 'csv' || ext === 'txt') {
          rows = this._parseCSV(await file.text());
        } else if (ext === 'xlsx' || ext === 'xls') {
          if (typeof XLSX === 'undefined') {
            this._addMessage('Error: librería XLSX no disponible. Recargá la página.', 'agent');
            return;
          }
          const data = await file.arrayBuffer();
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
            .map(r => r.map(c => String(c).trim()));
        } else {
          this._addMessage('Formato no soportado. Usá CSV o Excel (.xlsx).', 'agent');
          return;
        }

        if (!rows || rows.length < 2) {
          this._addMessage('El archivo está vacío o no tiene datos suficientes.', 'agent');
          return;
        }

        const result = this._processIbraData(rows);
        if (result.samples.length === 0) {
          this._addMessage('No se pudieron extraer datos de análisis del archivo. Verificá que sea un resultado de laboratorio IBRA.', 'agent');
          return;
        }

        this._showIbraResults(result);

      } catch (err) {
        this._addMessage(`Error al procesar: \`${err.message}\``, 'agent');
        console.error('[PIX Agent] IBRA import error:', err);
      }
    };
    input.click();
  }

  _parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const first = lines[0];
    let delim = ',';
    if (first.split(';').length > first.split(',').length) delim = ';';
    else if (first.split('\t').length > first.split(',').length) delim = '\t';

    return lines.map(line => {
      const result = [];
      let current = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === delim && !inQ) { result.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      result.push(current.trim());
      return result;
    });
  }

  _processIbraData(rows) {
    // Find header row
    let headerIdx = 0;
    let bestMatchCount = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const matches = rows[i].filter(c => {
        const key = String(c).toLowerCase().replace(/[()²³\-_]/g, ' ').trim();
        return this.ibraColumnMap[key] !== undefined;
      }).length;
      if (matches > bestMatchCount) {
        bestMatchCount = matches;
        headerIdx = i;
      }
    }

    const headers = rows[headerIdx].map(h => {
      const key = String(h).toLowerCase().replace(/[()²³\-_]/g, ' ').trim();
      return this.ibraColumnMap[key] || null;
    });

    const samples = [];
    const mappedFields = headers.filter(Boolean);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      // Skip empty rows
      const nonEmpty = row.filter(c => c && c !== '0' && c !== '-').length;
      if (nonEmpty < 2) continue;

      const sample = {};
      let hasData = false;
      headers.forEach((field, j) => {
        if (field && row[j] !== undefined && row[j] !== '') {
          let val = row[j];
          // Parse numeric values (handle comma as decimal)
          if (field !== 'sampleId') {
            val = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(val)) {
              sample[field] = val;
              hasData = true;
            }
          } else {
            sample[field] = String(val);
          }
        }
      });
      if (hasData) samples.push(sample);
    }

    return { samples, mappedFields, headerIdx, totalRows: rows.length - headerIdx - 1 };
  }

  _showIbraResults(result) {
    const { samples, mappedFields } = result;

    let msg = `**Resultado IBRA importado:**\n\n`;
    msg += `Muestras encontradas: **${samples.length}**\n`;
    msg += `Parámetros mapeados: **${mappedFields.length}** (${mappedFields.join(', ')})\n\n`;

    if (samples.length > 0) {
      const first = samples[0];
      msg += `**Muestra 1${first.sampleId ? ` (${first.sampleId})` : ''}:**\n`;
      for (const [key, val] of Object.entries(first)) {
        if (key !== 'sampleId') {
          msg += `  ${key}: ${val}\n`;
        }
      }
    }

    msg += `\n¿Deseo **auto-rellenar** el formulario de análisis de suelo con estos datos?`;
    this._addMessage(msg, 'agent');

    // Store for auto-fill
    this._pendingIbraData = result;

    // Add action buttons
    const container = document.getElementById('agentMessages');
    const actDiv = document.createElement('div');
    actDiv.className = 'agent-msg agent-msg-agent';
    actDiv.innerHTML = `
      <div class="agent-action-buttons">
        <button class="agent-action-btn primary" onclick="pixAgent.autoFillSoilFromIbra()">Auto-rellenar Análisis</button>
        <button class="agent-action-btn" onclick="pixAgent.exportIbraJSON()">Exportar JSON</button>
        <button class="agent-action-btn" onclick="pixAgent._addMessage('Datos descartados.','agent')">Cancelar</button>
      </div>
    `;
    container.appendChild(actDiv);
    container.scrollTop = container.scrollHeight;
  }

  autoFillSoilFromIbra() {
    if (!this._pendingIbraData || !this._pendingIbraData.samples.length) {
      this._addMessage('No hay datos IBRA pendientes. Importá un archivo primero.', 'agent');
      return;
    }

    const app = window.admin;
    if (!app) {
      this._addMessage('Error: instancia de PIX Admin no disponible.', 'agent');
      return;
    }

    // Use first sample to fill form
    const sample = this._pendingIbraData.samples[0];
    const fieldMap = {
      'pH': 'soilPH', 'pH_CaCl2': 'soilPH',
      'MO': 'soilMO', 'P': 'soilP', 'K': 'soilK',
      'Ca': 'soilCa', 'Mg': 'soilMg', 'Al': 'soilAl',
      'H_Al': 'soilHAl', 'S': 'soilS', 'B': 'soilB',
      'Cu': 'soilCu', 'Fe': 'soilFe', 'Mn': 'soilMn',
      'Zn': 'soilZn', 'Na': 'soilNa', 'CTC': 'soilCTC',
      'SB': 'soilSB', 'V': 'soilV', 'm_Al': 'soilmAl',
      'arcilla': 'soilArcilla', 'arena': 'soilArena', 'limo': 'soilLimo'
    };

    let filled = 0;
    for (const [ibraKey, formId] of Object.entries(fieldMap)) {
      if (sample[ibraKey] !== undefined) {
        const input = document.getElementById(formId);
        if (input) {
          input.value = sample[ibraKey];
          input.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
      }
    }

    // Set sample ID
    if (sample.sampleId) {
      const idField = document.getElementById('soilSampleId');
      if (idField) idField.value = sample.sampleId;
    }

    // Navigate to soil view
    if (app.showView) app.showView('soil');

    // Update soilData in app
    if (app.readSoilForm) app.readSoilForm();

    this._addMessage(
      `**Auto-rellenado completado:**\n` +
      `${filled} campos completados en el formulario de análisis de suelo.\n` +
      `${this._pendingIbraData.samples.length > 1 ? `Quedan ${this._pendingIbraData.samples.length - 1} muestras adicionales.` : ''}\n` +
      `Revisá los valores y ajustá si es necesario.`,
      'agent'
    );

    // If multiple samples, store remaining
    if (this._pendingIbraData.samples.length > 1) {
      this._pendingIbraData.samples.shift();
      this._addMessage(`Usá \`/siguiente-muestra\` para cargar la próxima muestra.`, 'agent');
    } else {
      this._pendingIbraData = null;
    }
  }

  exportIbraJSON() {
    if (!this._pendingIbraData) return;
    const json = JSON.stringify(this._pendingIbraData.samples, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ibra-data.json';
    a.click();
    URL.revokeObjectURL(url);
    this._addMessage('Archivo JSON exportado.', 'agent');
  }

  // ===== EMAIL MONITORING =====

  _checkEmail() {
    this._addMessage(
      '**Verificación de Email:**\n\n' +
      'Monitoreando:\n' +
      '- `gis.agronomico@gmail.com` — Resultados IBRA\n' +
      '- `nilton.camargo@pixadvisor.network` — Comunicación clientes\n\n' +
      'Para activar el monitoreo automático de email, el agente necesita acceso a la API de Gmail. ' +
      'Esto se configura mediante los conectores MCP disponibles en el entorno.\n\n' +
      'Mientras tanto, podés importar manualmente los CSV que recibás de IBRA con `/importar-ibra`.',
      'agent'
    );
  }

  // ===== SPEECH / VOICE =====

  _setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[PIX Agent] Speech recognition not available');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'es-AR';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      this._addMessage(transcript, 'user');
      this._processInput(transcript);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      const btn = document.getElementById('agentVoiceBtn');
      if (btn) btn.classList.remove('listening');
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      const btn = document.getElementById('agentVoiceBtn');
      if (btn) btn.classList.remove('listening');
      if (event.error !== 'no-speech') {
        this._addMessage(`Error de voz: ${event.error}. Intentá de nuevo.`, 'agent', 'system');
      }
    };
  }

  toggleVoice() {
    if (!this.recognition) {
      this._addMessage('Reconocimiento de voz no disponible en este navegador. Usá Chrome para mejor compatibilidad.', 'agent');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    } else {
      try {
        this.recognition.start();
        this.isListening = true;
        const btn = document.getElementById('agentVoiceBtn');
        if (btn) btn.classList.add('listening');
        this._addMessage('Escuchando... hablá ahora.', 'agent', 'system');
      } catch (e) {
        this._addMessage('No se pudo iniciar el micrófono. Verificá los permisos.', 'agent');
      }
    }
  }

  speak(text) {
    if (!this.synthesis || !this.voiceEnabled) return;
    // Cancel current speech
    this.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*/g, '').replace(/`/g, ''));
    utterance.lang = 'es-AR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Try to find Spanish voice
    const voices = this.synthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith('es'));
    if (esVoice) utterance.voice = esVoice;

    utterance.onstart = () => { this.isSpeaking = true; };
    utterance.onend = () => { this.isSpeaking = false; };

    this.synthesis.speak(utterance);
  }

  // ===== DATA VALIDATION =====

  validateSoilData(data) {
    const warnings = [];
    const ranges = {
      pH: [3.5, 9.0], MO: [0, 120], P: [0, 500], K: [0, 50],
      Ca: [0, 300], Mg: [0, 100], Al: [0, 50], H_Al: [0, 250],
      S: [0, 100], B: [0, 10], Cu: [0, 50], Fe: [0, 500],
      Mn: [0, 300], Zn: [0, 50], V: [0, 100]
    };

    for (const [param, [min, max]] of Object.entries(ranges)) {
      if (data[param] !== undefined) {
        const val = parseFloat(data[param]);
        if (isNaN(val)) {
          warnings.push(`${param}: valor no numérico`);
        } else if (val < min || val > max) {
          warnings.push(`${param}: ${val} fuera del rango esperado (${min}-${max})`);
        }
      }
    }

    if (warnings.length > 0) {
      this._addMessage(
        '**Advertencia de validación:**\n' + warnings.map(w => `- ${w}`).join('\n'),
        'agent', 'system'
      );
    }
    return warnings;
  }

  // ===== TASK AUTOMATION METHODS =====

  autoLoadDemoSoil() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }
    app.showView('soil');
    app.loadDemoSoil();
    this._addMessage('**Demo de suelo cargado.** Datos de ejemplo en el formulario de análisis.\nUsá `/interpretar` para ver la interpretación automática.', 'agent');
  }

  autoLoadDemoLeaf() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }
    app.showView('leaf');
    app.loadDemoLeaf();
    this._addMessage('**Demo foliar cargado.** Datos de ejemplo según el cultivo actual.\nUsá `/interpretar-hoja` para calcular DRIS/IBN.', 'agent');
  }

  autoClearSoilForm() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }
    app.clearSoilForm();
    this._addMessage('Formulario de análisis de suelo limpiado.', 'agent');
  }

  autoInterpretSoil() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    // Read current form data
    const data = app.getSoilFormData ? app.getSoilFormData() : app.soilData;
    if (!data || Object.keys(data).length < 3) {
      this._addMessage('No hay suficientes datos de suelo cargados. Usá `/demo-suelo` para cargar datos de ejemplo o importá un CSV de IBRA.', 'agent');
      return;
    }

    // Validate first
    this.validateSoilData(data);

    // Navigate to interpretation view
    app.showView('soil-interpretation');
    this._addMessage(
      '**Interpretación de suelo ejecutada.**\n\n' +
      `Cultivo: **${app.cropId}**\n` +
      `Parámetros analizados: **${Object.keys(data).length}**\n\n` +
      'La interpretación detallada se muestra en la vista actual.\n' +
      'Revisá también **Relaciones** (`/navegar relaciones`) y **Correcciones** (`/navegar correcciones`).',
      'agent'
    );
  }

  autoInterpretLeaf() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    const data = app.getLeafFormData ? app.getLeafFormData() : app.leafData;
    if (!data || Object.keys(data).length < 3) {
      this._addMessage('No hay suficientes datos foliares. Usá `/demo-foliar` para cargar datos de ejemplo.', 'agent');
      return;
    }

    app.showView('leaf-dris');
    this._addMessage(
      '**DRIS / IBN calculado.**\n\n' +
      `Cultivo: **${app.cropId}**\n` +
      `Nutrientes analizados: **${Object.keys(data).length}**\n\n` +
      'El diagnóstico DRIS se muestra en la vista actual.\n' +
      'Para cruzar con suelo: `/navegar diagnostico-cruzado`.',
      'agent'
    );
  }

  autoGenerateReport() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    const soilData = app.soilData || {};
    if (Object.keys(soilData).length < 3) {
      this._addMessage('No hay datos suficientes para generar un informe. Cargá análisis de suelo primero.\n\nFlujo rápido:\n1. `/demo-suelo` (cargar datos)\n2. `/interpretar` (analizar)\n3. `/reporte` (generar informe)', 'agent');
      return;
    }

    app.showView('interpretation');
    this._addMessage(
      '**Informe completo generado.**\n\n' +
      'El reporte incluye:\n' +
      '- Interpretación de suelo\n' +
      '- Relaciones entre nutrientes\n' +
      '- Recomendaciones de corrección\n' +
      '- Enmiendas y fertilización\n\n' +
      'Para exportar como PDF, usá el botón de impresión en la vista de informe.',
      'agent'
    );
  }

  autoNavigate(dest) {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    if (!dest) {
      this._addMessage(
        '**Vistas disponibles para navegar:**\n\n' +
        '`/navegar dashboard` — Panel principal\n' +
        '`/navegar suelo` — Análisis de suelo\n' +
        '`/navegar interpretacion` — Interpretación suelo\n' +
        '`/navegar relaciones` — Relaciones nutrientes\n' +
        '`/navegar correcciones` — Correcciones y enmiendas\n' +
        '`/navegar foliar` — Análisis foliar\n' +
        '`/navegar dris` — DRIS / IBN\n' +
        '`/navegar cruzado` — Diagnóstico cruzado\n' +
        '`/navegar gis` — Dashboard GIS\n' +
        '`/navegar mapas` — Mapas de nutrientes\n' +
        '`/navegar zonas` — Zonas de manejo\n' +
        '`/navegar muestreo` — Puntos de muestreo\n' +
        '`/navegar prescripcion` — Prescripción VRT\n' +
        '`/navegar informe` — Informe completo\n' +
        '`/navegar protocolo` — Protocolo de aplicación\n' +
        '`/navegar financiero` — Estudio financiero',
        'agent'
      );
      return;
    }

    const viewMap = {
      'dashboard': 'dashboard', 'inicio': 'dashboard', 'panel': 'dashboard',
      'suelo': 'soil', 'soil': 'soil', 'analisis suelo': 'soil',
      'interpretacion': 'soil-interpretation', 'interpretar': 'soil-interpretation',
      'relaciones': 'soil-relationships', 'relacion': 'soil-relationships',
      'correcciones': 'soil-amendments', 'enmiendas': 'soil-amendments', 'correccion': 'soil-amendments',
      'foliar': 'leaf', 'hoja': 'leaf', 'leaf': 'leaf',
      'dris': 'leaf-dris', 'ibn': 'leaf-dris',
      'cruzado': 'leaf-cross', 'diagnostico cruzado': 'leaf-cross', 'cross': 'leaf-cross',
      'gis': 'gis-dashboard', 'dashboard gis': 'gis-dashboard',
      'mapas': 'nutrient-maps', 'nutrientes': 'nutrient-maps', 'fertilidad': 'nutrient-maps',
      'mapas relaciones': 'relation-maps',
      'zonas': 'management-zones', 'zonas de manejo': 'management-zones', 'manejo': 'management-zones',
      'muestreo': 'sampling-points', 'puntos': 'sampling-points', 'sampling': 'sampling-points',
      'prescripcion': 'prescription', 'vrt': 'prescription',
      'idw': 'engine-idw', 'kriging': 'engine-kriging',
      'variograma': 'engine-variogram', 'validacion': 'engine-validation',
      'informe': 'interpretation', 'reporte': 'interpretation', 'report': 'interpretation',
      'protocolo': 'report-protocol', 'aplicacion': 'report-protocol',
      'financiero': 'report-financial', 'roi': 'report-financial',
      'exportar': 'report-export', 'export': 'report-export',
      'muestras': 'samples', 'lab': 'samples',
      'cultivos': 'manage-crops', 'clientes': 'manage-clients',
      'config': 'settings', 'configuracion': 'settings'
    };

    const viewId = viewMap[dest.trim()];
    if (viewId) {
      app.showView(viewId);
      this._addMessage(`Navegando a **${dest}**.`, 'agent');
    } else {
      this._addMessage(`Vista "${dest}" no encontrada. Usá \`/navegar\` sin parámetros para ver las opciones.`, 'agent');
    }
  }

  autoSetCrop(cropName) {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    if (!cropName) {
      this._addMessage('Usá `/cultivo [nombre]`. Ej: `/cultivo soja`, `/cultivo maiz`, `/cultivo cana`.', 'agent');
      return;
    }

    const cropMap = {
      'cana': 'cana', 'caña': 'cana', 'caña de azucar': 'cana', 'sugarcane': 'cana',
      'soja': 'soja', 'soya': 'soja', 'soybean': 'soja',
      'maiz': 'maiz', 'maíz': 'maiz', 'corn': 'maiz',
      'sorgo': 'sorgo', 'sorghum': 'sorgo',
      'girasol': 'girasol', 'sunflower': 'girasol',
      'chia': 'chia', 'chía': 'chia',
      'tomate': 'tomate', 'tomato': 'tomate',
      'pimenton': 'pimenton', 'pimentón': 'pimenton', 'aji': 'pimenton',
      'papa': 'papa', 'potato': 'papa',
      'maracuya': 'maracuya', 'maracuyá': 'maracuya',
      'palta': 'palta', 'aguacate': 'palta', 'avocado': 'palta'
    };

    const cropId = cropMap[cropName.trim()];
    if (cropId) {
      app.setCrop(cropId);
      const sel = document.getElementById('globalCrop');
      if (sel) sel.value = cropId;
      this._addMessage(`Cultivo cambiado a **${cropName}**. Todas las interpretaciones se actualizarán según este cultivo.`, 'agent');
    } else {
      this._addMessage(`Cultivo "${cropName}" no encontrado. Disponibles: caña, soja, maíz, sorgo, girasol, chía, tomate, pimentón, papa, maracuyá, palta.`, 'agent');
    }
  }

  autoExport() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    const exportData = {
      timestamp: new Date().toISOString(),
      cultivo: app.cropId,
      metaRendimiento: app.yieldTarget,
      datosCliente: app.clientData,
      suelo: app.soilData,
      foliar: app.leafData,
      muestras: app.samples,
      fieldBoundary: app.fieldBoundary,
      areaHa: app.fieldAreaHa
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pix-admin-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this._addMessage(
      '**Datos exportados.**\n\n' +
      `Archivo: pix-admin-export-${new Date().toISOString().slice(0,10)}.json\n` +
      `Incluye: suelo, foliar, ${app.samples.length} muestras, perímetro, config.`,
      'agent'
    );
  }

  autoNextSample() {
    if (!this._pendingIbraData || !this._pendingIbraData.samples.length) {
      this._addMessage('No hay muestras IBRA pendientes. Importá un archivo con `/importar-ibra`.', 'agent');
      return;
    }
    this.autoFillSoilFromIbra();
  }

  autoValidateAll() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    let issues = 0;
    let report = '**Validación completa:**\n\n';

    // Validate soil
    const soilData = app.getSoilFormData ? app.getSoilFormData() : app.soilData;
    if (soilData && Object.keys(soilData).length > 0) {
      const soilWarnings = this.validateSoilData(soilData);
      if (soilWarnings.length === 0) {
        report += '**Suelo:** Sin problemas\n';
      } else {
        report += `**Suelo:** ${soilWarnings.length} advertencias\n`;
        issues += soilWarnings.length;
      }
    } else {
      report += '**Suelo:** Sin datos cargados\n';
    }

    // Validate leaf
    const leafData = app.getLeafFormData ? app.getLeafFormData() : app.leafData;
    if (leafData && Object.keys(leafData).length > 0) {
      report += `**Foliar:** ${Object.keys(leafData).length} nutrientes cargados\n`;
    } else {
      report += '**Foliar:** Sin datos cargados\n';
    }

    // Validate samples
    report += `**Muestras:** ${app.samples.length} cargadas\n`;
    const withCoords = app.samples.filter(s => s.lat && s.lng).length;
    if (app.samples.length > 0) {
      report += `  - Con coordenadas: ${withCoords}/${app.samples.length}\n`;
      if (withCoords < app.samples.length) {
        report += '  - ⚠ Algunas muestras sin georreferencia\n';
        issues++;
      }
    }

    // Validate boundary
    if (app.fieldBoundary) {
      report += `**Perímetro:** Cargado (${app.fieldAreaHa} ha)\n`;
    } else {
      report += '**Perímetro:** No cargado (necesario para mapas GIS)\n';
    }

    report += `\n**Resultado:** ${issues === 0 ? 'Todo OK' : issues + ' advertencia(s) encontrada(s)'}`;
    this._addMessage(report, 'agent');
  }

  autoFullSummary() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    const soilData = app.getSoilFormData ? app.getSoilFormData() : app.soilData;
    let summary = '**Resumen Ejecutivo PIX Admin:**\n\n';

    summary += `**Cliente:** ${app.clientData.nombre || 'Sin configurar'}\n`;
    summary += `**Propiedad:** ${app.clientData.propiedad || 'Sin configurar'}\n`;
    summary += `**Lote:** ${app.clientData.lote || 'Sin configurar'}\n`;
    summary += `**Área:** ${app.fieldAreaHa || 0} ha\n`;
    summary += `**Cultivo:** ${app.cropId} | Meta: ${app.yieldTarget} t/ha\n\n`;

    if (soilData && Object.keys(soilData).length > 0) {
      summary += '**Suelo:**\n';
      if (soilData.pH_H2O) summary += `- pH: ${soilData.pH_H2O} ${soilData.pH_H2O < 5.5 ? '(ácido — encalado)' : soilData.pH_H2O > 7 ? '(alcalino)' : '(adecuado)'}\n`;
      if (soilData.MO) summary += `- MO: ${soilData.MO} g/dm³ ${soilData.MO < 15 ? '(bajo)' : soilData.MO > 30 ? '(alto)' : '(medio)'}\n`;
      if (soilData.P) summary += `- P: ${soilData.P} mg/dm³\n`;
      if (soilData.K) summary += `- K: ${soilData.K} cmolc/dm³\n`;
      if (soilData.Ca) summary += `- Ca: ${soilData.Ca} cmolc/dm³\n`;
      if (soilData.Mg) summary += `- Mg: ${soilData.Mg} cmolc/dm³\n`;
      if (soilData.V !== undefined) summary += `- V%: ${soilData.V}%\n`;

      // Quick diagnostic
      const alerts = [];
      if (soilData.pH_H2O && soilData.pH_H2O < 5.5) alerts.push('pH bajo → necesita encalado');
      if (soilData.Al && soilData.Al > 5) alerts.push('Al tóxico → encalado urgente');
      if (soilData.P && soilData.P < 10) alerts.push('P bajo → fosfatado');
      if (soilData.K && soilData.K < 1.5) alerts.push('K bajo → potásico');
      if (soilData.MO && soilData.MO < 15) alerts.push('MO baja → materia orgánica');
      if (alerts.length > 0) {
        summary += '\n**Alertas:** ' + alerts.join(', ') + '\n';
      }
    } else {
      summary += '**Suelo:** Sin datos\n';
    }

    summary += `\n**Muestras:** ${app.samples.length} | **Errores:** ${this.errorLog.length}`;

    this._addMessage(summary, 'agent');
  }

  // ===== CLIENT / PROPERTY / LOT REGISTRATION =====

  autoRegisterClient() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    // Show client management view
    app.showView('manage-clients');

    this._addMessage(
      '**Registro de Cliente:**\n\n' +
      'Completá los datos del cliente en el formulario.\n\n' +
      'También podés decirme los datos y los cargo automáticamente:\n' +
      '"Registrar cliente Juan Pérez, hacienda San Miguel, Departamento Central"\n\n' +
      'O usá los comandos rápidos:\n' +
      '`/cliente nombre: Juan Pérez`\n' +
      '`/propiedad nombre: San Miguel, ubicacion: Central`',
      'agent'
    );

    // Add action buttons for quick registration
    const container = document.getElementById('agentMessages');
    const actDiv = document.createElement('div');
    actDiv.className = 'agent-msg agent-msg-agent';
    actDiv.innerHTML = `
      <div class="agent-action-buttons">
        <button class="agent-action-btn primary" onclick="pixAgent._openClientForm()">Nuevo Cliente</button>
        <button class="agent-action-btn" onclick="pixAgent._listClients()">Ver Clientes</button>
      </div>
    `;
    container.appendChild(actDiv);
    container.scrollTop = container.scrollHeight;
  }

  autoRegisterProperty() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    this._addMessage(
      '**Registro de Hacienda/Propiedad:**\n\n' +
      'Para registrar una propiedad necesitás:\n' +
      '- **Nombre** de la hacienda/finca\n' +
      '- **Ubicación** (departamento/estado)\n' +
      '- **Área total** (hectáreas)\n' +
      '- **Propietario/Cliente** asociado\n' +
      '- **Perímetro** (opcional, se puede cargar KML/GeoJSON)\n\n' +
      '**Datos del cliente actual:**\n' +
      `- Nombre: ${app.clientData.nombre || '—'}\n` +
      `- Propiedad: ${app.clientData.propiedad || '—'}\n` +
      `- Ubicación: ${app.clientData.ubicacion || '—'}\n` +
      `- Lote: ${app.clientData.lote || '—'}\n` +
      `- Área: ${app.clientData.area || '—'}\n\n` +
      'Podés actualizar los datos con:\n' +
      '`/set-cliente nombre=Juan, propiedad=San Miguel, ubicacion=Central, lote=A1, area=50`',
      'agent'
    );
  }

  autoRegisterLot() {
    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    this._addMessage(
      '**Registro de Lote/Parcela:**\n\n' +
      '**Datos necesarios:**\n' +
      '- Nombre/código del lote\n' +
      '- Área (ha)\n' +
      '- Cultivo actual\n' +
      '- Historial de cultivos\n' +
      '- Perímetro georreferenciado\n\n' +
      '**Para cargar perímetro:**\n' +
      '- Importar KML/GeoJSON del lote\n' +
      '- O dibujar en el mapa GIS\n\n' +
      '**Lote actual:** ' + (app.clientData.lote || 'Sin configurar') +
      '\n**Área:** ' + (app.clientData.area || 'Sin configurar') +
      '\n\nNavegá a **Gestión > Clientes** para configurar.',
      'agent'
    );

    app.showView('manage-clients');
  }

  _openClientForm() {
    const app = window.admin;
    if (!app) return;

    // Auto-fill with prompt
    this._addMessage(
      'Decime los datos del cliente en este formato:\n\n' +
      '"nombre: [nombre], propiedad: [hacienda], ubicacion: [lugar], lote: [lote], area: [hectáreas]"\n\n' +
      'Ejemplo: "nombre: Carlos López, propiedad: Estancia La Aurora, ubicacion: San Pedro, lote: 5A, area: 120"',
      'agent'
    );

    // Temporarily override processInput to capture client data
    this._awaitingClientData = true;
  }

  _listClients() {
    const app = window.admin;
    if (!app) return;

    // Check localStorage for saved clients
    let clients = [];
    try {
      const saved = localStorage.getItem('pix_clients');
      if (saved) clients = JSON.parse(saved);
    } catch(e) {}

    if (clients.length === 0) {
      this._addMessage(
        '**Clientes registrados:**\n\n' +
        'No hay clientes guardados todavía.\n' +
        `**Cliente actual en sesión:**\n` +
        `- ${app.clientData.nombre || 'Sin nombre'} — ${app.clientData.propiedad || 'Sin propiedad'}`,
        'agent'
      );
    } else {
      let list = '**Clientes registrados:**\n\n';
      clients.forEach((c, i) => {
        list += `${i+1}. **${c.nombre}** — ${c.propiedad || '—'} (${c.ubicacion || '—'}) — ${c.area || '—'} ha\n`;
      });
      this._addMessage(list, 'agent');
    }
  }

  // Enhanced processInput to handle client data capture
  _processClientData(text) {
    const app = window.admin;
    if (!app) return false;

    // Parse "nombre: X, propiedad: Y, ..." format
    const fields = {};
    const parts = text.split(',').map(p => p.trim());
    for (const part of parts) {
      const match = part.match(/^(\w+)\s*:\s*(.+)$/);
      if (match) {
        fields[match[1].toLowerCase()] = match[2].trim();
      }
    }

    if (Object.keys(fields).length >= 1) {
      // Update client data
      if (fields.nombre) app.clientData.nombre = fields.nombre;
      if (fields.propiedad) app.clientData.propiedad = fields.propiedad;
      if (fields.ubicacion) app.clientData.ubicacion = fields.ubicacion;
      if (fields.lote) app.clientData.lote = fields.lote;
      if (fields.area) app.clientData.area = fields.area;
      if (fields.responsable) app.clientData.responsable = fields.responsable;

      // Save to localStorage
      let clients = [];
      try {
        const saved = localStorage.getItem('pix_clients');
        if (saved) clients = JSON.parse(saved);
      } catch(e) {}

      // Add or update
      const existing = clients.findIndex(c => c.nombre === app.clientData.nombre);
      if (existing >= 0) {
        clients[existing] = { ...app.clientData, updatedAt: new Date().toISOString() };
      } else {
        clients.push({ ...app.clientData, createdAt: new Date().toISOString() });
      }
      localStorage.setItem('pix_clients', JSON.stringify(clients));

      this._addMessage(
        '**Cliente registrado/actualizado:**\n\n' +
        `- Nombre: **${app.clientData.nombre}**\n` +
        `- Propiedad: **${app.clientData.propiedad || '—'}**\n` +
        `- Ubicación: **${app.clientData.ubicacion || '—'}**\n` +
        `- Lote: **${app.clientData.lote || '—'}**\n` +
        `- Área: **${app.clientData.area || '—'}** ha\n\n` +
        `Total clientes guardados: **${clients.length}**`,
        'agent'
      );

      this._awaitingClientData = false;
      return true;
    }
    return false;
  }

  autoWorkflow() {
    this._addMessage(
      '**Workflow Completo Automatizado:**\n\n' +
      'Ejecutando secuencia automática...\n',
      'agent'
    );

    const app = window.admin;
    if (!app) { this._addMessage('Error: PIX Admin no disponible.', 'agent'); return; }

    const steps = [];
    const soilData = app.getSoilFormData ? app.getSoilFormData() : app.soilData;
    const hasSoil = soilData && Object.keys(soilData).length >= 3;

    // Step 1: Check data
    if (!hasSoil) {
      steps.push({ delay: 500, action: () => {
        this._addMessage('**Paso 1/5:** Cargando datos demo de suelo...', 'agent');
        app.showView('soil');
        app.loadDemoSoil();
      }});
    } else {
      steps.push({ delay: 500, action: () => {
        this._addMessage('**Paso 1/5:** Datos de suelo detectados. Continuando...', 'agent');
      }});
    }

    // Step 2: Interpret
    steps.push({ delay: 2000, action: () => {
      this._addMessage('**Paso 2/5:** Interpretando análisis de suelo...', 'agent');
      if (app.interpretSoil) app.interpretSoil();
      app.showView('soil-interpretation');
    }});

    // Step 3: Relationships
    steps.push({ delay: 3500, action: () => {
      this._addMessage('**Paso 3/5:** Calculando relaciones entre nutrientes...', 'agent');
      app.showView('soil-relationships');
    }});

    // Step 4: Amendments
    steps.push({ delay: 5000, action: () => {
      this._addMessage('**Paso 4/5:** Calculando correcciones y enmiendas...', 'agent');
      app.showView('soil-amendments');
    }});

    // Step 5: Full report
    steps.push({ delay: 7000, action: () => {
      this._addMessage('**Paso 5/5:** Generando informe completo...', 'agent');
      app.showView('interpretation');
    }});

    // Final
    steps.push({ delay: 9000, action: () => {
      this._addMessage(
        '**Workflow completado.**\n\n' +
        'Se ejecutaron automáticamente:\n' +
        '1. Carga/verificación de datos\n' +
        '2. Interpretación de suelo\n' +
        '3. Relaciones entre nutrientes\n' +
        '4. Correcciones y enmiendas\n' +
        '5. Informe completo\n\n' +
        'El informe está listo para exportar o imprimir.',
        'agent'
      );
    }});

    // Execute steps sequentially
    steps.forEach(step => {
      setTimeout(step.action, step.delay);
    });
  }

  // ===== AUTOMATIONS REGISTRY =====

  _registerAutomations() {
    this.automations = [
      {
        name: 'IBRA CSV Auto-Import',
        trigger: 'manual',
        description: 'Importa y parsea archivos CSV de laboratorio IBRA megalab',
        action: () => this._triggerIbraImport()
      },
      {
        name: 'Error Monitor',
        trigger: 'auto',
        description: 'Captura errores JavaScript y rejections en tiempo real',
        action: () => {} // runs via _setupErrorMonitor
      },
      {
        name: 'Data Validation',
        trigger: 'on-data-change',
        description: 'Valida rangos de datos de análisis al cargar',
        action: (data) => this.validateSoilData(data)
      },
      {
        name: 'Auto-Backup',
        trigger: 'interval-5min',
        description: 'Backup automático de datos a localStorage',
        action: () => this._autoBackup()
      },
      {
        name: 'Email Check IBRA',
        trigger: 'manual',
        description: 'Verifica correo para resultados de IBRA megalab',
        action: () => this._checkEmail()
      }
    ];
  }
}

// ===== GLOBAL INIT =====
let pixAgent;
document.addEventListener('DOMContentLoaded', () => {
  // Wait for admin app to initialize first
  setTimeout(() => {
    pixAgent = new PixAdminAgent();
    pixAgent.init();
    window.pixAgent = pixAgent;
  }, 500);
});
