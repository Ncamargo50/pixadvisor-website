// GPS Navigation Module for PIX Muestreo
class GPSNavigator {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.targetPoint = null;
    this.trackPositions = [];
    this.isTracking = false;
    this.onPositionUpdate = null;
    this.onDistanceUpdate = null;
    this.accuracy = null;

    // Kalman filter state for position smoothing
    this.kalman = {
      lat: null, lng: null,
      variance: 1,
      // Dynamic process noise — ADAPTIVE based on movement
      // Base value: ~3m movement between readings (in degree² ≈ (3m / 111000m/deg)² ≈ 7e-10)
      // But we boost when speed detected → up to 100x for fast walking/driving
      baseProcessNoise: 0.000001,
      processNoise: 0.000001,
      initialized: false,
      lastTimestamp: 0
    };

    // GPS warm-up detection
    this.warmupReadings = [];
    this.isWarmedUp = false;
    this.warmupThreshold = 2; // need 2 readings under 15m accuracy (fastest warm-up)
    this._warmupStartTime = null; // 2.3: timeout tracking
    this._warmupDegraded = false; // true if warm-up forced by timeout

    // Position stabilization detection
    this.recentPositions = []; // last 10 positions
    this.isStabilized = false;

    // Movement detection
    this.speed = 0;              // m/s estimated from position delta
    this.isMoving = false;
    this._lastPos = null;
    this._lastTime = 0;

    // Native GNSS bridge data (Level 2: real satellite metadata)
    // Populated from Android GNSSBridge via JavascriptInterface
    this.nativeGNSS = null;      // { satellites, dop, quality, available }
    this._gnssPollingId = null;
  }

  // Start watching position
  startWatch(callback) {
    if (!navigator.geolocation) {
      throw new Error('GPS no disponible en este dispositivo');
    }

    this.onPositionUpdate = callback;

    // Start native GNSS polling if Android bridge is available
    this._startNativeGNSSPolling();

    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        // Check GPS warm-up status
        this._checkWarmup(pos.coords.accuracy);

        // Estimate speed from position delta (more reliable than GPS speed on WebView)
        this._estimateSpeed(pos.coords.latitude, pos.coords.longitude, pos.timestamp);

        // Adapt Kalman process noise based on movement
        this._adaptProcessNoise(pos.coords.speed, pos.timestamp);

        // Apply Kalman filter for position smoothing
        const smoothed = this._kalmanUpdate(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          pos.coords.accuracy,
          pos.timestamp
        );

        this.currentPosition = {
          lat: smoothed.lat,
          lng: smoothed.lng,
          accuracy: pos.coords.accuracy, // keep raw accuracy for display
          altitude: pos.coords.altitude,
          speed: this.speed,             // use our computed speed (more reliable)
          gpsSpeed: pos.coords.speed,    // keep raw GPS speed too
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
          raw: { lat: pos.coords.latitude, lng: pos.coords.longitude }
        };
        this.accuracy = pos.coords.accuracy;

        // Check position stabilization
        this._checkStabilization();

        // Record track
        if (this.isTracking) {
          this.trackPositions.push({
            lat: smoothed.lat,
            lng: smoothed.lng,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          });
        }

        // Calculate distance to target
        if (this.targetPoint) {
          const dist = this.distanceTo(
            smoothed.lat, smoothed.lng,
            this.targetPoint.lat, this.targetPoint.lng
          );
          const bearing = this.bearingTo(
            smoothed.lat, smoothed.lng,
            this.targetPoint.lat, this.targetPoint.lng
          );
          if (this.onDistanceUpdate) {
            this.onDistanceUpdate(dist, bearing);
          }
        }

        if (this.onPositionUpdate) {
          this.onPositionUpdate(this.currentPosition);
        }
      },
      err => {
        console.error('GPS error:', err);
        if (callback) callback(null, err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,     // Allow up to 2s cached readings — reduces jitter
        timeout: 10000        // 10 sec timeout
      }
    );
  }

  // Stop watching
  stopWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this._stopNativeGNSSPolling();
  }

  // Start tracking route
  startTracking() {
    this.isTracking = true;
    this.trackPositions = [];
  }

  // Stop tracking
  stopTracking() {
    this.isTracking = false;
    return [...this.trackPositions];
  }

  // Set navigation target
  setTarget(lat, lng, name) {
    this.targetPoint = { lat, lng, name };
  }

  // Clear target
  clearTarget() {
    this.targetPoint = null;
  }

  // Haversine distance (meters) — null-safe
  distanceTo(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return NaN;
    if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) return NaN;
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Bearing to target (degrees)
  bearingTo(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
      Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // Format distance
  formatDistance(meters) {
    if (meters < 1) return '< 1 m';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
  }

  // B1 FIX: Compass direction (Spanish: O=Oeste, SO=Suroeste, NO=Noroeste)
  compassDirection(bearing) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']; // Spanish cardinals
    const idx = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return dirs[idx];
  }

  // Get current position once
  async getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // ═══════════════════════════════════════════════════════════
  // MOVEMENT DETECTION - Speed estimation from position deltas
  // ═══════════════════════════════════════════════════════════

  _estimateSpeed(lat, lng, timestamp) {
    if (this._lastPos && this._lastTime) {
      const dt = (timestamp - this._lastTime) / 1000; // seconds
      if (dt > 0.5 && dt < 30) { // valid time delta
        const dist = this.distanceTo(this._lastPos.lat, this._lastPos.lng, lat, lng);
        const rawSpeed = dist / dt;

        // Low-pass filter on speed to avoid GPS jitter spikes
        // Standing-still GPS jitter produces 0.3-0.8 m/s phantom speed
        if (rawSpeed < 0.5) {
          this.speed = this.speed * 0.7; // decay slowly to zero (absorbs jitter)
        } else {
          this.speed = this.speed * 0.6 + rawSpeed * 0.4; // smooth response to real movement
        }

        this.isMoving = this.speed > 0.6; // walking threshold ~0.6 m/s ≈ 2 km/h (filters GPS noise)
      }
    }
    this._lastPos = { lat, lng };
    this._lastTime = timestamp;
  }

  // ═══════════════════════════════════════════════════════════
  // ADAPTIVE KALMAN - Adjusts process noise based on movement
  // ═══════════════════════════════════════════════════════════

  _adaptProcessNoise(gpsSpeed, timestamp) {
    // Use our estimated speed (more reliable on WebView) or GPS speed as fallback
    const speed = this.speed || (gpsSpeed != null ? gpsSpeed : 0);

    // Convert speed to degree-movement per second
    // 1 m/s = ~0.000009 degrees/sec (at equator)
    const degPerSec = speed / 111000;

    // Time since last reading
    const dt = this.kalman.lastTimestamp ? (timestamp - this.kalman.lastTimestamp) / 1000 : 1;

    // Process noise = expected position change variance
    // When moving: high noise → filter follows raw GPS closely
    // When still: low noise → filter smooths aggressively
    if (this.isMoving) {
      // Moving: trust new readings more — noise proportional to distance traveled
      const expectedMove = degPerSec * dt;
      this.kalman.processNoise = Math.max(expectedMove * expectedMove * 4, 0.000001);
    } else {
      // Standing still: smooth very aggressively — nearly frozen
      // Only ~0.3m drift per update to minimize jitter
      this.kalman.processNoise = 0.00000002;
    }

    this.kalman.lastTimestamp = timestamp;
  }

  // ═══════════════════════════════════════════════════════════
  // POINT AVERAGING - Mejora la precisión promediando lecturas
  // ═══════════════════════════════════════════════════════════

  /**
   * Toma múltiples lecturas GPS y las promedia para mejorar precisión.
   * En un celular Android con GPS dual-band puede bajar de ±5m a ±1-2m.
   *
   * @param {number} samples - Cantidad de lecturas (default 10)
   * @param {number} intervalMs - Intervalo entre lecturas en ms (default 1500)
   * @param {function} onProgress - Callback(samplesTaken, totalSamples, currentAccuracy)
   * @returns {Promise<{lat, lng, accuracy, samples, avgAccuracy}>}
   */
  async averagePosition(samples = 10, intervalMs = 1500, onProgress = null) {
    this._avgCompleted = false; // A2: Reset guard flag
    return new Promise((resolve, reject) => {
      const readings = [];
      let watchId = null;
      let timeoutId = null;
      const maxWait = (samples * intervalMs) + 15000; // timeout total

      // Filtro: solo aceptar lecturas con accuracy < 20m
      const maxAcceptableAccuracy = 20;

      // Use maximumAge: 0 for averaging — we need FRESH readings only
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy;

          // Solo aceptar lecturas con buena precisión
          if (acc <= maxAcceptableAccuracy) {
            readings.push({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: acc,
              altitude: pos.coords.altitude,
              timestamp: pos.timestamp
            });

            if (onProgress) {
              onProgress(readings.length, samples, acc);
            }
          }

          if (readings.length >= samples && !this._avgCompleted) {
            this._avgCompleted = true; // A2: Guard against double-resolve
            navigator.geolocation.clearWatch(watchId);
            clearTimeout(timeoutId);

            // ── Outlier rejection: reject readings >2 std deviations from median ──
            const sortedLats = readings.map(r => r.lat).sort((a, b) => a - b);
            const sortedLngs = readings.map(r => r.lng).sort((a, b) => a - b);
            const medianLat = sortedLats[Math.floor(sortedLats.length / 2)];
            const medianLng = sortedLngs[Math.floor(sortedLngs.length / 2)];

            // Compute distances from median and standard deviation
            const distsFromMedian = readings.map(r => this.distanceTo(medianLat, medianLng, r.lat, r.lng));
            const meanDist = distsFromMedian.reduce((s, d) => s + d, 0) / distsFromMedian.length;
            const distStdDev = Math.sqrt(distsFromMedian.reduce((s, d) => s + (d - meanDist) ** 2, 0) / distsFromMedian.length);
            const outlierThreshold = meanDist + 2 * distStdDev;

            // Filter out outliers (keep at least 3 readings)
            let filtered = readings.filter((r, i) => distsFromMedian[i] <= outlierThreshold);
            if (filtered.length < 3) filtered = readings; // fallback if too aggressive

            // Calcular promedio ponderado por inverso de accuracy
            // (lecturas más precisas pesan más)
            let totalWeight = 0;
            let wLat = 0, wLng = 0, wAlt = 0;
            let bestAcc = Infinity;

            for (const r of filtered) {
              // Guard: accuracy must be positive to avoid Infinity weight
              const acc = Math.max(r.accuracy, 0.1);
              const weight = 1 / (acc * acc); // peso cuadrático inverso
              totalWeight += weight;
              wLat += r.lat * weight;
              wLng += r.lng * weight;
              if (r.altitude !== null) wAlt += r.altitude * weight;
              if (r.accuracy < bestAcc) bestAcc = r.accuracy;
            }

            // Guard: if totalWeight is zero/NaN, fall back to simple average
            const avgLat = totalWeight > 0 ? wLat / totalWeight : filtered.reduce((s, r) => s + r.lat, 0) / filtered.length;
            const avgLng = totalWeight > 0 ? wLng / totalWeight : filtered.reduce((s, r) => s + r.lng, 0) / filtered.length;
            const avgAlt = totalWeight > 0 ? wAlt / totalWeight : 0;

            // Calcular dispersión real de las lecturas filtradas (desvío estándar en metros)
            let sumSqDist = 0;
            for (const r of filtered) {
              const d = this.distanceTo(avgLat, avgLng, r.lat, r.lng);
              sumSqDist += d * d;
            }
            const stdDev = Math.sqrt(sumSqDist / filtered.length);

            // Precisión estimada: mejor entre el desvío y la mejor accuracy reportada
            const estimatedAccuracy = Math.min(stdDev, bestAcc);
            const avgReportedAcc = filtered.reduce((s, r) => s + r.accuracy, 0) / filtered.length;

            resolve({
              lat: avgLat,
              lng: avgLng,
              altitude: avgAlt,
              accuracy: Math.round(estimatedAccuracy * 100) / 100,
              avgReportedAccuracy: Math.round(avgReportedAcc * 100) / 100,
              bestAccuracy: Math.round(bestAcc * 100) / 100,
              stdDevMeters: Math.round(stdDev * 100) / 100,
              samples: readings.length,
              samplesUsed: filtered.length,
              outliersRejected: readings.length - filtered.length,
              durationMs: readings[readings.length - 1].timestamp - readings[0].timestamp
            });
          }
        },
        (err) => {
          if (watchId) navigator.geolocation.clearWatch(watchId);
          clearTimeout(timeoutId);
          // Si tenemos al menos 3 lecturas, usamos lo que hay
          if (readings.length >= 3) {
            let totalWeight = 0, wLat = 0, wLng = 0;
            for (const r of readings) {
              const w = 1 / (r.accuracy * r.accuracy);
              totalWeight += w; wLat += r.lat * w; wLng += r.lng * w;
            }
            resolve({
              lat: wLat / totalWeight,
              lng: wLng / totalWeight,
              accuracy: readings.reduce((s, r) => s + r.accuracy, 0) / readings.length,
              samples: readings.length,
              partial: true
            });
          } else {
            reject(new Error('GPS: no se pudieron obtener suficientes lecturas'));
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,       // FRESH readings only for averaging
          timeout: 15000       // More time for precise fix
        }
      );

      // Timeout global
      timeoutId = setTimeout(() => {
        navigator.geolocation.clearWatch(watchId);
        if (readings.length >= 3) {
          let totalWeight = 0, wLat = 0, wLng = 0;
          for (const r of readings) {
            const w = 1 / (r.accuracy * r.accuracy);
            totalWeight += w; wLat += r.lat * w; wLng += r.lng * w;
          }
          resolve({
            lat: wLat / totalWeight,
            lng: wLng / totalWeight,
            accuracy: readings.reduce((s, r) => s + r.accuracy, 0) / readings.length,
            samples: readings.length,
            partial: true
          });
        } else {
          reject(new Error('GPS timeout: precisión insuficiente'));
        }
      }, maxWait);
    });
  }

  // Precisión del GPS actual en texto legible
  getAccuracyLabel() {
    if (!this.accuracy) return 'Sin señal';
    if (this.accuracy <= 2) return `⭐ Excelente (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 5) return `✅ Buena (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 10) return `⚠️ Aceptable (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 20) return `⚠️ Baja (${this.accuracy.toFixed(1)}m)`;
    return `❌ Mala (${this.accuracy.toFixed(0)}m) - esperá mejor señal`;
  }

  // Indicador de calidad GPS (0-100)
  getGPSQuality() {
    if (!this.accuracy) return 0;
    if (this.accuracy <= 1) return 100;
    if (this.accuracy <= 3) return 90;
    if (this.accuracy <= 5) return 75;
    if (this.accuracy <= 10) return 50;
    if (this.accuracy <= 20) return 25;
    return 10;
  }

  // Speed in km/h
  getSpeedKmh() {
    return Math.round(this.speed * 3.6 * 10) / 10;
  }

  // ═══════════════════════════════════════════════════════════
  // KALMAN FILTER - Suavizado de posición en tiempo real
  // ═══════════════════════════════════════════════════════════

  /**
   * Aplica un filtro Kalman simplificado a una lectura GPS.
   * ADAPTIVE: responds fast to movement, smooths when still.
   */
  _kalmanUpdate(measurement, accuracy, timestamp) {
    // Guard: reject NaN/undefined measurements (would poison filter permanently)
    if (!isFinite(measurement.lat) || !isFinite(measurement.lng) || !isFinite(accuracy) || accuracy <= 0) {
      // Return last known good position or raw measurement
      if (this.kalman.initialized) {
        return { lat: this.kalman.lat, lng: this.kalman.lng, accuracy: Math.sqrt(this.kalman.variance) };
      }
      return { lat: measurement.lat || 0, lng: measurement.lng || 0, accuracy: accuracy || 999 };
    }

    if (!this.kalman.initialized) {
      this.kalman.lat = measurement.lat;
      this.kalman.lng = measurement.lng;
      this.kalman.variance = accuracy * accuracy;
      this.kalman.initialized = true;
      this.kalman.lastTimestamp = timestamp;
      return { lat: measurement.lat, lng: measurement.lng, accuracy: accuracy };
    }

    // Predict step: variance increases with process noise
    this.kalman.variance += this.kalman.processNoise;

    // Update step: compute Kalman gain
    const measurementVariance = accuracy * accuracy;
    // Guard: if both variance and measurement variance are zero, return measurement directly (avoids 0/0 NaN)
    if (this.kalman.variance === 0 && measurementVariance === 0) return { lat: measurement.lat, lng: measurement.lng, accuracy: accuracy };
    const kalmanGain = this.kalman.variance / (this.kalman.variance + measurementVariance);

    // Clamp gain: ADAPTIVE based on movement state
    // Moving: balanced (0.4) → follows direction but smooths jumps
    // Still: heavy smoothing (0.08) → marker barely moves (eliminates jitter)
    const gainFloor = this.isMoving ? 0.4 : 0.08;
    const clampedGain = Math.max(gainFloor, Math.min(0.95, kalmanGain));

    // Update estimate
    this.kalman.lat += clampedGain * (measurement.lat - this.kalman.lat);
    this.kalman.lng += clampedGain * (measurement.lng - this.kalman.lng);
    this.kalman.variance *= (1 - clampedGain);

    // Prevent variance from collapsing to near-zero (would freeze the filter)
    this.kalman.variance = Math.max(this.kalman.variance, 0.0000001);

    // Safety: if NaN leaked through despite guards, reset filter
    if (!isFinite(this.kalman.lat) || !isFinite(this.kalman.lng)) {
      console.warn('[GPS] Kalman NaN detected — resetting filter');
      this.resetKalman();
      return { lat: measurement.lat, lng: measurement.lng, accuracy: accuracy };
    }

    return {
      lat: this.kalman.lat,
      lng: this.kalman.lng,
      accuracy: Math.sqrt(this.kalman.variance)
    };
  }

  // Reset Kalman filter (useful when GPS jumps or re-entering field)
  resetKalman() {
    this.kalman.initialized = false;
    this.kalman.lat = null;
    this.kalman.lng = null;
    this.kalman.variance = 1;
    this._lastPos = null;
    this._lastTime = 0;
    this.speed = 0;
    this.isMoving = false;
  }

  // ═══════════════════════════════════════════════════════════
  // GPS WARM-UP DETECTION - Detecta cuando el GPS se estabiliza
  // ═══════════════════════════════════════════════════════════

  _checkWarmup(accuracy) {
    this.warmupReadings.push(accuracy);
    if (!this._warmupStartTime) this._warmupStartTime = Date.now();

    // Mantener solo las últimas 10 lecturas
    if (this.warmupReadings.length > 10) {
      this.warmupReadings.shift();
    }

    // If ANY of the last 3 readings are < 15m → GPS warmed up (faster!)
    if (this.warmupReadings.length >= this.warmupThreshold) {
      const lastN = this.warmupReadings.slice(-this.warmupThreshold);
      if (lastN.every(a => a < 15)) {
        this.isWarmedUp = true;
        this._warmupDegraded = false;
        return;
      }
    }

    // 2.3 FIX: After 45s without achieving <15m, force warm-up with degraded flag
    // Prevents technician from being stuck indefinitely under tree cover/valleys
    if (!this.isWarmedUp && this._warmupStartTime) {
      const elapsed = (Date.now() - this._warmupStartTime) / 1000;
      if (elapsed > 45 && accuracy < 50) {
        this.isWarmedUp = true;
        this._warmupDegraded = true;
        console.warn(`[GPS] Warm-up forced after ${Math.round(elapsed)}s (accuracy ${accuracy.toFixed(1)}m)`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POSITION STABILIZATION - Detecta posición estable
  // ═══════════════════════════════════════════════════════════

  _checkStabilization() {
    if (!this.currentPosition) return;

    this.recentPositions.push({
      lat: this.currentPosition.lat,
      lng: this.currentPosition.lng,
      timestamp: this.currentPosition.timestamp
    });

    // Mantener solo las últimas 10 posiciones
    if (this.recentPositions.length > 10) {
      this.recentPositions.shift();
    }

    // Verificar si las últimas 5 están dentro de 3m (was 2m — too strict for real field)
    if (this.recentPositions.length >= 5) {
      const last5 = this.recentPositions.slice(-5);
      let maxSpread = 0;
      for (let i = 0; i < last5.length; i++) {
        for (let j = i + 1; j < last5.length; j++) {
          const d = this.distanceTo(last5[i].lat, last5[i].lng, last5[j].lat, last5[j].lng);
          if (d > maxSpread) maxSpread = d;
        }
      }
      this.isStabilized = maxSpread <= 3;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ACCURACY GATE - Control de calidad para recolección
  // ═══════════════════════════════════════════════════════════

  canCollect(requiredAccuracy = 5) {
    if (!this.isWarmedUp || this.accuracy === null) return false;
    if (this.accuracy <= requiredAccuracy) return true;
    // Allow degraded warmup (forced after 45s timeout) so technician isn't stuck
    return this._warmupDegraded && this.accuracy < 50;
  }

  getCollectionStatus(requiredAccuracy = 5) {
    if (!this.accuracy) return { ok: false, msg: 'Sin señal GPS', color: '#F44336' };
    if (!this.isWarmedUp) return { ok: false, msg: 'GPS calentando...', color: '#FF9800' };
    // 2.3: Allow collection with degraded accuracy warning (timeout forced warm-up)
    if (this._warmupDegraded && this.accuracy > requiredAccuracy) {
      return { ok: true, msg: `Precisión degradada (${this.accuracy.toFixed(1)}m) — cobertura limitada`, color: '#FF9800' };
    }
    if (this.accuracy > requiredAccuracy) return { ok: false, msg: `Precisión insuficiente (${this.accuracy.toFixed(1)}m > ${requiredAccuracy}m)`, color: '#FF9800' };
    return { ok: true, msg: `Listo (${this.accuracy.toFixed(1)}m)`, color: '#4CAF50' };
  }

  // ═══════════════════════════════════════════════════════════
  // HDOP — Real (native) or estimated (fallback)
  // ═══════════════════════════════════════════════════════════

  /**
   * Returns real HDOP from native GNSS bridge if available,
   * otherwise estimates from accuracy (accuracy ≈ HDOP × 5m base error).
   */
  getEstimatedHDOP() {
    // Real HDOP from native bridge (parsed from NMEA GSA)
    if (this.nativeGNSS?.dop?.hdop && this.nativeGNSS.dop.hdop < 50) {
      return this.nativeGNSS.dop.hdop;
    }
    // Fallback: estimate from reported accuracy
    if (!this.accuracy) return null;
    return Math.round(this.accuracy / 5 * 10) / 10;
  }

  /**
   * Returns true if real HDOP is available (not estimated).
   */
  hasRealHDOP() {
    return !!(this.nativeGNSS?.dop?.hdop && this.nativeGNSS.dop.hdop < 50);
  }

  // ═══════════════════════════════════════════════════════════
  // NATIVE GNSS BRIDGE — Polls Android GNSSBridge for satellite data
  // Level 2: Real satellite count, HDOP/PDOP, SNR, L1/L5, constellations
  // ═══════════════════════════════════════════════════════════

  /**
   * Checks if native GNSS bridge is available (running inside PIX Muestreo APK).
   */
  hasNativeGNSS() {
    return typeof window.AndroidGNSS !== 'undefined';
  }

  /**
   * Start polling native GNSS data every 2 seconds.
   * Called automatically from startWatch() if AndroidGNSS bridge exists.
   */
  _startNativeGNSSPolling() {
    if (!this.hasNativeGNSS()) {
      console.log('[GPS] Native GNSS bridge not available (browser/non-APK)');
      return;
    }

    console.log('[GPS] Native GNSS bridge detected — starting satellite polling');

    // Initial poll
    this._pollNativeGNSS();

    // Poll every 2 seconds (GNSS status updates ~1/sec from Android).
    // Battery-aware: skip the JNI round-trip while the document is hidden
    // (screen off / app backgrounded). watchPosition itself keeps running so
    // that ongoing sampling navigation is not interrupted.
    this._gnssPollingId = setInterval(() => {
      if (document.hidden) return;
      this._pollNativeGNSS();
    }, 2000);

    // Fire an immediate poll when the user returns to the app so the UI
    // reflects the latest satellite state without a 2-second delay.
    if (!this._gnssVisibilityBound) {
      this._gnssVisibilityHandler = () => {
        if (!document.hidden && this._gnssPollingId) this._pollNativeGNSS();
      };
      document.addEventListener('visibilitychange', this._gnssVisibilityHandler);
      this._gnssVisibilityBound = true;
    }
  }

  /**
   * Stop native GNSS polling.
   */
  _stopNativeGNSSPolling() {
    if (this._gnssPollingId) {
      clearInterval(this._gnssPollingId);
      this._gnssPollingId = null;
    }
    if (this._gnssVisibilityBound) {
      document.removeEventListener('visibilitychange', this._gnssVisibilityHandler);
      this._gnssVisibilityBound = false;
    }
  }

  /**
   * Single poll of native GNSS data.
   * Updates this.nativeGNSS with satellite info and DOP values.
   */
  _pollNativeGNSS() {
    try {
      if (!window.AndroidGNSS || !window.AndroidGNSS.isAvailable()) return;

      const satRaw = window.AndroidGNSS.getSatelliteInfo();
      const dopRaw = window.AndroidGNSS.getDOPValues();

      const satellites = satRaw ? JSON.parse(satRaw) : {};
      const dop = dopRaw ? JSON.parse(dopRaw) : {};

      this.nativeGNSS = {
        satellites,
        dop,
        available: true,
        timestamp: Date.now()
      };
    } catch (e) {
      // Bridge call failed — don't crash, just log once
      if (!this._gnssErrorLogged) {
        console.warn('[GPS] Native GNSS poll error:', e.message);
        this._gnssErrorLogged = true;
      }
    }
  }

  /**
   * Get formatted satellite summary for display.
   * Returns object with display-ready strings.
   */
  getGNSSDisplayInfo() {
    if (!this.nativeGNSS?.available) {
      return {
        available: false,
        satText: '',
        dopText: '',
        constellationText: '',
        qualityText: '',
        dualFreqText: ''
      };
    }

    const s = this.nativeGNSS.satellites;
    const d = this.nativeGNSS.dop;

    // Satellite count: "12/20 sats"
    const satText = `${s.usedSatellites || 0}/${s.totalSatellites || 0} sats`;

    // DOP: "HDOP 1.2"
    const hdopVal = d.hdop && d.hdop < 50 ? d.hdop : null;
    const dopText = hdopVal ? `HDOP ${hdopVal}` : '';

    // Constellations: "G8 R2 E4" (compact)
    const parts = [];
    if (s.gps > 0) parts.push(`G${s.gps}`);
    if (s.glonass > 0) parts.push(`R${s.glonass}`);
    if (s.galileo > 0) parts.push(`E${s.galileo}`);
    if (s.beidou > 0) parts.push(`C${s.beidou}`);
    if (s.sbas > 0) parts.push(`S${s.sbas}`);
    const constellationText = parts.join(' ');

    // Signal quality: "C/N0 avg 32.5 dB"
    const qualityText = s.avgCn0 > 0 ? `C/N0 ${s.avgCn0}dB` : '';

    // Dual frequency
    const dualFreqText = s.hasDualFreq ? `L1+L5 (${s.l5Count})` : (s.l1Count > 0 ? 'L1' : '');

    return {
      available: true,
      satText,
      dopText,
      constellationText,
      qualityText,
      dualFreqText,
      usedSats: s.usedSatellites || 0,
      totalSats: s.totalSatellites || 0,
      hdop: hdopVal,
      fixType: d.fixType || 0,
      fixLabel: d.fixLabel || '',
      hasDualFreq: !!s.hasDualFreq,
      avgCn0: s.avgCn0 || 0,
      bestCn0: s.bestCn0 || 0
    };
  }
}

const gpsNav = new GPSNavigator();
